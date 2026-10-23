// Game flow: menu, name prompt, play vs computer (local sim), play online (server sim over a WebSocket), spectating.
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const renderer = Renderer.create(canvas);
  const DT = Sim.DT;

  let mode = 'menu';           // menu | local | online
  let seat = -1;               // 0 or 1 when playing, -1 when spectating
  let names = ['Player 1', 'Player 2'];
  let myName = '';
  let game = null, bot = null, acc = 0, lastFrame = performance.now();
  let ws = null, role = 'player', room = null;
  let buffer = [];             // received snapshots, for interpolation
  let view = null;             // snapshot being drawn
  let lastPhase = '', lastScore = '0-0';
  let rematchSent = false;
  let session = null;          // { code, token } for the game we are in; kept so a refresh can take the seat back
  let retry = null;            // while (re)connecting: { msg, until, timer }
  let netNote = '';            // shown while the connection is being restored
  let pausedUntil = 0, pausedWho = '';
  const RETRY_MS = 60000;      // how long we keep trying to reach the server, and how long the server holds a seat
  const keys = { left: false, right: false, jump: false, smash: false, drop: false, normal: false, far: false, near: false, hit: false };

  // phones and tablets: on-screen buttons while playing (?touch=1 forces them on, for trying it on a computer)
  const isTouch = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).get('touch') === '1';
  document.body.classList.toggle('touch', isTouch);
  const buzz = (pattern) => { if (isTouch && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* not supported (iPhone) */ } } };

  const SIM_LAG = Math.max(0, Math.min(400, Number(new URLSearchParams(location.search).get('lag')) || 0));

  const inviteCode = (new URLSearchParams(location.search).get('g') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  // ---------- panels ----------
  function show(panel) {
    $('overlay').classList.toggle('hidden', !panel);
    $('overlay').classList.toggle('onmenu', panel === 'pMenu');
    $('help').style.visibility = panel === 'pMenu' ? 'hidden' : '';
    for (const id of ['pMenu', 'pWait', 'pMsg']) $(id).hidden = id !== panel;
  }

  function message(title, text, buttons) {
    $('msgTitle').textContent = title;
    $('msgText').textContent = text || '';
    const box = $('msgButtons');
    box.textContent = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.secondary) el.className = 'secondary';
      el.addEventListener('click', () => { Sound.unlock(); b.onClick(); });
      box.appendChild(el);
    }
    show('pMsg');
  }

  function goMenu() {
    leaveOnline();
    mode = 'menu'; game = null; bot = null; view = null; buffer = []; seat = -1; room = null;
    renderer.reset();
    $('hud').hidden = true; $('banner').hidden = true; $('sub').hidden = true; $('menuBtn').hidden = true;
    Sound.ambience(false);
    history.replaceState(null, '', location.pathname);
    $('joinNote').hidden = true; $('btnJoin').hidden = true; $('btnCreate').hidden = false;
    show('pMenu');
  }

  // ---------- name ----------
  // Remembered in this browser (localStorage, with a cookie as backup), so it is only ever typed once.
  function cleanName(raw) { return String(raw || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14); }
  function savedName() {
    try { const v = cleanName(localStorage.getItem('bm-name')); if (v) return v; } catch (e) { /* storage blocked */ }
    const c = document.cookie.match(/(?:^|; )bm_name=([^;]*)/);
    try { return c ? cleanName(decodeURIComponent(c[1])) : ''; } catch (e) { return ''; }
  }
  function saveName(n) {
    try { localStorage.setItem('bm-name', n); } catch (e) { /* ignore */ }
    document.cookie = `bm_name=${encodeURIComponent(n)}; max-age=31536000; path=/; SameSite=Lax`;
  }
  function showNameUI(editing) {
    $('nameRow').hidden = editing || !myName;
    $('nameBox').hidden = !editing && !!myName;
    $('nameShown').textContent = myName;
    if (editing) { $('name').value = myName; $('name').focus(); $('name').select(); }
  }
  function getName() {
    if (!$('nameBox').hidden) {
      const n = cleanName($('name').value);
      if (!n) { $('name').focus(); $('nameErr').hidden = false; return null; }
      $('nameErr').hidden = true;
      myName = n; saveName(n); showNameUI(false);
    }
    return myName;
  }

  // ---------- local game against the computer ----------
  function startLocal() {
    const n = getName(); if (!n) return;
    Sound.unlock(); Sound.blip();
    const level = Number($('level').value);
    mode = 'local'; seat = 0; role = 'player';
    names = [n, 'Computer'];
    game = new Sim.Game();
    bot = new AI.Bot(1, level);
    acc = 0; renderer.reset(); lastPhase = ''; lastScore = '0-0';
    $('hud').hidden = false; $('menuBtn').hidden = false; show(null);
    updateNames(); Sound.ambience(true);
  }

  // ---------- online ----------
  const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  function saveSession(s) {
    session = s;
    try { if (s) sessionStorage.setItem('bm-session', JSON.stringify(s)); else sessionStorage.removeItem('bm-session'); } catch (e) { /* ignore */ }
  }
  function stopRetry() { if (retry) { clearTimeout(retry.timer); retry = null; } netNote = ''; }

  // Reach the server, and keep trying for a minute: the first connection may hit a server that is still waking up,
  // and a game that loses its connection has to be able to find its seat again.
  function connectOnline(msg) {
    stopRetry();
    retry = { msg, until: Date.now() + RETRY_MS, timer: null };
    tryConnect();
  }

  function secsLeft() { return retry ? Math.max(0, Math.ceil((retry.until - Date.now()) / 1000)) : 0; }

  function showRetrying() {
    if (mode === 'connecting') {
      message('Connecting…', `Reaching the game server (trying for ${secsLeft()} more seconds).`, [{ label: 'Cancel', secondary: true, onClick: goMenu }]);
    } else netNote = 'Connection lost. Reconnecting…';
  }

  function tryConnect() {
    if (!retry) return;
    let sock;
    try { sock = new WebSocket(wsUrl()); } catch (e) { sock = null; }
    ws = sock;
    if (!sock) { scheduleRetry(); return; }
    if (SIM_LAG) {   // ?lag=80 adds that many ms each way, to try the game as if the server were far away
      const realSend = sock.send.bind(sock);
      sock.send = (d) => setTimeout(() => { if (sock.readyState === 1) realSend(d); }, SIM_LAG);
    }
    sock.onopen = () => { if (ws === sock && retry) sock.send(JSON.stringify(retry.msg)); };
    sock.onmessage = (e) => {
      const go = () => { if (ws !== sock) return; let m; try { m = JSON.parse(e.data); } catch (err) { return; } onServer(m); };
      if (SIM_LAG) setTimeout(go, SIM_LAG); else go();
    };
    sock.onclose = () => {
      if (ws !== sock) return;            // closed on purpose
      ws = null;
      if (!retry && mode === 'online' && session) {
        // an established game lost its connection: take the same seat back (or keep watching)
        retry = { msg: session.token ? { t: 'rejoin', code: session.code, token: session.token } : { t: 'join', code: session.code }, until: Date.now() + RETRY_MS, timer: null };
      }
      scheduleRetry();
    };
  }

  function scheduleRetry() {
    if (!retry) return;
    if (Date.now() >= retry.until) {
      stopRetry(); saveSession(null);
      const wasPlaying = mode === 'online';
      mode = 'menu';
      message(wasPlaying ? 'Connection lost' : 'Could not connect', wasPlaying ? 'We could not get back to the game server in time.' : 'The game server did not answer. Please try again.', [{ label: 'Back to menu', onClick: goMenu }]);
      return;
    }
    showRetrying();
    retry.timer = setTimeout(tryConnect, 1500);
  }

  function leaveOnline() {
    stopPingTest();
    stopRetry(); saveSession(null); pausedUntil = 0;
    if (ws) { const s = ws; ws = null; try { s.send(JSON.stringify({ t: 'leave' })); s.close(); } catch (e) { /* closed */ } }
  }

  function startOnline(code) {
    const n = getName(); if (!n) return;
    Sound.unlock(); Sound.blip();
    mode = 'connecting';
    show(null);
    connectOnline(code ? { t: 'join', code, name: n } : { t: 'create', name: n });
    showRetrying();
  }

  // a refresh or a returning tab picks its game up again
  function resumeSession() {
    let s = null;
    try { s = JSON.parse(sessionStorage.getItem('bm-session') || 'null'); } catch (e) { s = null; }
    if (!s || !s.code || (inviteCode && inviteCode !== s.code)) { saveSession(null); return false; }
    session = s;
    mode = 'connecting';
    show(null);
    connectOnline(s.token ? { t: 'rejoin', code: s.code, token: s.token } : { t: 'join', code: s.code });
    showRetrying();
    return true;
  }

  // ---------- connection test ----------
  // Silent: as soon as we are connected the browser times a burst of pings to the server, then keeps checking. From
  // that it picks how far behind to draw the game (a steadier connection needs less) and tells the server, which
  // judges this player's hits against what they actually saw. Each player is measured and adjusted on their own.
  let viewDelay = 55;               // ms behind the server that the game is drawn
  let pingTimer = null, pingSamples = [], pingSent = 0, reportedRtt = -1;
  function stopPingTest() { clearInterval(pingTimer); pingTimer = null; pingSamples = []; pingSent = 0; reportedRtt = -1; }
  function startPingTest() {
    stopPingTest();
    const fire = () => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ t: 'ping', c: performance.now() })); pingSent++; } };
    fire();
    // a quick burst of eight at first, then one every two seconds
    pingTimer = setInterval(() => { fire(); if (pingSent === 8) { clearInterval(pingTimer); pingTimer = setInterval(fire, 2000); } }, 150);
  }
  function onPong(sent) {
    const rtt = performance.now() - sent;
    if (!(rtt >= 0 && rtt < 3000)) return;
    pingSamples.push(rtt);
    if (pingSamples.length > 16) pingSamples.shift();
    if (pingSamples.length < 4) return;
    const sorted = pingSamples.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    const jitter = pingSamples.reduce((a, v) => a + Math.abs(v - median), 0) / pingSamples.length;
    // draw the game a little further behind when the connection is bumpy (never less than two server updates)
    const want = Math.max(34, Math.min(110, 34 + jitter * 2.2));
    viewDelay += (want - viewDelay) * 0.5;
    if (reportedRtt < 0 || Math.abs(median - reportedRtt) > Math.max(8, reportedRtt * 0.2)) {
      reportedRtt = median;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'rtt', rtt: Math.round(median), view: Math.round(viewDelay) }));
    }
  }

  function link() { return `${location.origin}/?g=${room.code}`; }

  function onServer(m) {
    switch (m.t) {
      case 'joined':
        stopRetry();
        mode = 'online'; role = m.role; seat = m.seat; room = m.room; names = room.names.slice();
        saveSession({ code: room.code, token: m.token || null });
        startPingTest();
        if (!m.resumed) { renderer.reset(); buffer = []; view = null; rematchSent = false; lastPhase = ''; lastScore = '0-0'; pausedUntil = 0; }
        else buffer = [];
        $('hud').hidden = false; $('menuBtn').hidden = false; updateNames(); Sound.ambience(true);
        if (role === 'player' && !room.started) {
          $('shareLink').value = link();
          $('btnShare').hidden = !navigator.share;
          show('pWait');
        } else show(null);
        break;
      case 'start':
        room = m.room; names = room.names.slice(); updateNames();
        renderer.reset(); buffer = []; rematchSent = false; lastPhase = ''; lastScore = '0-0'; pausedUntil = 0;
        show(null);
        break;
      case 'room': room = m.room; break;
      case 'pong': onPong(m.c); break;
      case 'snap': {
        buffer.push({ t: performance.now(), s: m.s });
        if (buffer.length > 12) buffer.shift();
        handleEvents(m.s.ev, m.s);
        break;
      }
      case 'paused':
        pausedWho = m.who; pausedUntil = performance.now() + (m.secs || 60) * 1000;
        break;
      case 'resumed':
        pausedUntil = 0;
        break;
      case 'rematch':
        if (m.who !== seat) $('sub').textContent = `${names[m.who]} wants a rematch`;
        break;
      case 'ended': {
        stopRetry(); saveSession(null); pausedUntil = 0;
        const s = ws; ws = null; if (s) s.close();
        const why = m.why === 'left' ? `${m.who || 'A player'} left the game.` : 'This game was closed.';
        message('Game ended', why, [{ label: 'Back to menu', onClick: goMenu }]);
        break;
      }
      case 'error': {
        const quiet = m.code === 'norejoin' && mode === 'connecting';   // a stale session on page load: just show the menu
        const wasPlaying = mode === 'online';
        stopRetry(); saveSession(null); pausedUntil = 0;
        const s = ws; ws = null; if (s) s.close();
        if (quiet) { goMenu(); break; }
        mode = 'menu';
        const title = m.code === 'nogame' ? 'Game not found' : (m.code === 'norejoin' && wasPlaying ? 'Game over' : 'Oops');
        message(title, m.msg, [
          { label: 'Back to menu', onClick: () => { history.replaceState(null, '', location.pathname); goMenu(); } },
        ]);
        break;
      }
      default:
    }
  }

  // ---------- input ----------
  // arrow up/down double as "serve further / shorter" while a serve is pending (the server cannot jump then anyway)
  const KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', KeyW: 'jump', ArrowDown: 'near',
    KeyA: 'normal',
    Space: 'hit', Enter: 'hit',
  };
  function sendInput() {
    if (mode === 'local' && game) game.setInput(0, keys);
    else if (mode === 'online' && ws && seat >= 0 && ws.readyState === 1) ws.send(JSON.stringify({ t: 'input', ...keys }));
  }
  function setKey(code, down) {
    const k = KEYMAP[code];
    if (!k) return false;
    let changed = false;
    for (const f of [].concat(k)) { if (keys[f] !== down) { keys[f] = down; changed = true; } }
    if (changed) sendInput();
    return changed;
  }
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if ((mode === 'local' || mode === 'online') && KEYMAP[e.code]) { e.preventDefault(); if (!e.repeat) setKey(e.code, true); }
  });
  window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) { e.preventDefault(); setKey(e.code, false); } });
  window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; sendInput(); });

  // ---------- events -> sound and effects ----------
  function handleEvents(events, snap) {
    if (!events || !events.length) return;
    const sh = snap ? snap.sh : [6.7];
    renderer.onEvents(events, { shuttleX: sh[0] });
    for (const e of events) {
      if (e.k === 'hit') { Sound.hit(e.t, e.p, e.x); if (e.i === seat) buzz(e.t === 'smash' ? 45 : e.t === 'drop' ? 10 : 18); }
      else if (e.k === 'swing') Sound.swing(e.x);
      else if (e.k === 'aim') { if (e.i === seat) Sound.blip(); }
      else if (e.k === 'net') Sound.net(e.p, e.x);
      else if (e.k === 'floor') Sound.floor(e.p, e.x);
      else if (e.k === 'step') Sound.step(e.x, e.v);
      else if (e.k === 'squeak') Sound.squeak(e.x);
      else if (e.k === 'jump') Sound.jump(e.x);
      else if (e.k === 'land') Sound.land(e.x);
      else if (e.k === 'point') { Sound.point(seat < 0 ? true : e.w === seat); if (seat >= 0) buzz(e.w === seat ? [25, 40, 25] : 70); }
      else if (e.k === 'over') Sound.fanfare(seat < 0 ? true : e.w === seat);
    }
  }

  // ---------- HUD ----------
  function updateNames() {
    $('n0').textContent = names[0]; $('n1').textContent = names[1];
  }

  function updateHud(s) {
    const score = `${s.sc[0]}-${s.sc[1]}`;
    if (score !== lastScore) {
      lastScore = score;
      for (const i of [0, 1]) { const el = $('s' + i); el.textContent = s.sc[i]; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    } else if ($('s0').textContent === '') { $('s0').textContent = s.sc[0]; $('s1').textContent = s.sc[1]; }
    $('d0').classList.toggle('on', s.sv === 0 && s.ph !== 'over');
    $('d1').classList.toggle('on', s.sv === 1 && s.ph !== 'over');
    $('side0').classList.toggle('me', seat === 0); $('side1').classList.toggle('me', seat === 1);

    const gp = s.gp;
    const sc = $('gp');
    if (gp >= 0) { sc.hidden = false; sc.textContent = s.sc[0] === s.sc[1] ? 'DEUCE' : `GAME POINT: ${names[gp]}`; }
    else if (s.sc[0] >= 14 && s.sc[1] >= 14 && s.ph !== 'over') { sc.hidden = false; sc.textContent = 'DEUCE: win by 2'; }
    else sc.hidden = true;

    const spectators = mode === 'online' && room ? room.spectators : 0;
    $('watchers').hidden = !(role === 'spectator' || spectators > 0);
    $('watchers').textContent = role === 'spectator' ? `👀 Spectating · ${spectators} watching` : `👀 ${spectators} watching`;

    const banner = $('banner'), sub = $('sub');
    if (pausedUntil) {
      banner.hidden = true; sub.hidden = false;
      sub.textContent = `${pausedWho} lost connection. Waiting for them to come back… ${Math.max(0, Math.ceil((pausedUntil - performance.now()) / 1000))}s`;
      return;
    }
    if (netNote) { banner.hidden = true; sub.hidden = false; sub.textContent = `${netNote} ${secsLeft()}s`; return; }
    if (s.ph !== lastPhase) {
      lastPhase = s.ph;
      if (s.ph === 'over') {
        const win = s.w;
        banner.hidden = true; sub.hidden = true;
        const title = seat < 0 ? `${names[win]} wins!` : (win === seat ? 'You win! 🏆' : `${names[win]} wins`);
        const text = `Final score ${s.sc[0]} – ${s.sc[1]}`;
        const buttons = mode === 'local'
          ? [{ label: 'Play again', onClick: () => { startLocalAgain(); } }, { label: 'Menu', secondary: true, onClick: goMenu }]
          : (seat >= 0
            ? [{ label: 'Rematch', onClick: sendRematch }, { label: 'Leave', secondary: true, onClick: goMenu }]
            : [{ label: 'Leave', secondary: true, onClick: goMenu }]);
        setTimeout(() => { if (lastPhase === 'over') message(title, text, buttons); }, 1300);
      }
    }
    if (s.ph === 'serve') {
      banner.hidden = true; sub.hidden = false;
      sub.textContent = s.sv === seat ? (isTouch ? 'Your serve: ▲ ▼ set the strength, hold HIT and let go at the angle you want' : 'Your serve: ↑ ↓ set the strength, hold Space and let go at the angle you want') : `${names[s.sv]} to serve`;
    } else if (s.ph === 'point') {
      banner.hidden = false; sub.hidden = true;
      banner.textContent = `${names[s.sv]} scores!`;
    } else if (s.ph === 'rally') { banner.hidden = true; sub.hidden = true; } else if (s.ph === 'over') { banner.hidden = true; sub.hidden = true; }
  }

  function startLocalAgain() {
    game.reset(game.winner < 0 ? 0 : game.winner);
    bot = new AI.Bot(1, Number($('level').value));
    lastPhase = ''; lastScore = '0-0'; renderer.reset(); show(null);
  }

  function sendRematch() {
    if (rematchSent) return;
    rematchSent = true;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'rematch' }));
    $('msgText').textContent = 'Waiting for the other player to accept…';
    for (const b of $('msgButtons').children) if (b.textContent === 'Rematch') b.disabled = true;
  }

  // ---------- interpolation for online play ----------
  function lerp(a, b, u) { return a + (b - a) * u; }
  function lerpAngle(a, b, u) {
    const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + d * u;
  }
  function interpolated() {
    if (!buffer.length) return null;
    const rt = performance.now() - viewDelay;
    let i = buffer.length - 1;
    while (i > 0 && buffer[i - 1].t > rt) i--;
    if (i === 0) return buffer[0].s;
    const a = buffer[i - 1], b = buffer[i];
    if (rt >= b.t) return b.s;
    const u = Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t)));
    const sa = a.s, sb = b.s;
    const out = Object.assign({}, sb);
    out.p = sb.p.map((pb, k) => {
      const pa = sa.p[k];
      if (Math.abs(pa[0] - pb[0]) > 3) return pb;
      return [lerp(pa[0], pb[0], u), lerp(pa[1], pb[1], u), pb[2], pb[3], pb[4], pb[5]];
    });
    const ha = sa.sh, hb = sb.sh;
    out.sh = Math.hypot(ha[0] - hb[0], ha[1] - hb[1]) > 3 ? hb : [lerp(ha[0], hb[0], u), lerp(ha[1], hb[1], u), hb[2], hb[3], lerpAngle(ha[4], hb[4], u)];
    return out;
  }

  // ---------- touch controls ----------
  let touchShown = false;
  function pulse(name) { keys[name] = true; sendInput(); setTimeout(() => { keys[name] = false; sendInput(); }, 70); }
  function holdButton(el) {
    const name = el.dataset.k;
    const set = (down) => {
      if (keys[name] === down) return;
      keys[name] = down; el.classList.toggle('down', down);
      if (down && name === 'hit') buzz(10);
      sendInput();
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); Sound.unlock(); try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } set(true); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, () => set(false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  if (isTouch) {
    for (const el of document.querySelectorAll('#touch [data-k]')) holdButton(el);
    // iOS Safari ignores user-scalable=no: stop pinch and double-tap zoom here too
    for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }
  // keep the screen on while playing (Android, and iOS 16.4 and later); asked again when the page comes back to the front
  let wake = null;
  function keepAwake() {
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { wake = l; }).catch(() => {}); } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => { if (isTouch && document.visibilityState === 'visible' && document.body.classList.contains('playing')) keepAwake(); });
  // The page plays sideways on a phone held upright: body.rot turns the whole app a quarter turn (see the css), which
  // works even with auto-rotate off. The compact and tiny layouts depend on the size of the app, not of the screen.
  function layout() {
    const portrait = innerHeight > innerWidth;
    const rot = isTouch && document.body.classList.contains('playing') && portrait;
    const changed = rot !== document.body.classList.contains('rot');
    document.body.classList.toggle('rot', rot);
    const h = rot ? innerWidth : innerHeight;
    document.documentElement.classList.toggle('compact', h < 520);
    document.documentElement.classList.toggle('tiny', h < 420);
    if (changed) setTimeout(() => window.dispatchEvent(new Event('resize')), 0);   // so the canvas takes the app's new size
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  layout();
  function updateTouch(s) {
    const playing = (mode === 'local' || mode === 'online') && seat >= 0;
    const show = playing && !!s && $('overlay').classList.contains('hidden');
    if (playing && !document.body.classList.contains('playing')) keepAwake();
    if (playing !== document.body.classList.contains('playing')) { document.body.classList.toggle('playing', playing); layout(); }
    if (show !== touchShown) {
      touchShown = show; $('touch').hidden = !show;
      if (!show) for (const el of document.querySelectorAll('#touch .down')) el.classList.remove('down');
    }
  }

  // ---------- main loop ----------
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    const frameStart = performance.now();
    if (mode === 'local' && game && $('overlay').classList.contains('hidden')) {
      acc += dt;
      while (acc >= DT) {
        game.setInput(1, bot.update(game, DT));
        game.step();
        acc -= DT;
      }
      view = game.snapshot();
      handleEvents(view.ev, view);
    } else if (mode === 'local' && game) view = game.snapshot(); // paused behind a panel: keep drawing the same scene
    else if (mode === 'online') view = interpolated();
    if (view) updateHud(view);
    if (isTouch) updateTouch(view);
    const simMs = performance.now() - frameStart;
    if (mode === 'menu' || mode === 'connecting') renderer.draw(demoScene(dt), { names: DEMO_NAMES, seat: -1 });
    else renderer.draw(view, { names, seat });
    if (window.__renderStats) window.__renderStats.sim = simMs;
    requestAnimationFrame(frame);
  }

  // behind the menu: two computer players rally for real (silent), and start over when a game ends
  const DEMO_NAMES = ['Aria', 'Kai'];
  let demo = null, demoAcc = 0, demoPause = 0;
  function demoScene(dt) {
    if (!demo) { demo = { game: new Sim.Game(), bots: [new AI.Bot(0, 2), new AI.Bot(1, 2)] }; demoAcc = 0; demoPause = 0; }
    const g = demo.game;
    if (g.phase === 'over') {
      demoPause += dt;
      if (demoPause > 2.5) { g.reset(g.winner < 0 ? 0 : g.winner); demoPause = 0; }
    } else {
      demoAcc += dt;
      while (demoAcc >= DT) {
        g.setInput(0, demo.bots[0].update(g, DT));
        g.setInput(1, demo.bots[1].update(g, DT));
        g.step();
        demoAcc -= DT;
      }
    }
    const v = g.snapshot();
    if (v.ev && v.ev.length) renderer.onEvents(v.ev, { shuttleX: v.sh[0] });
    return v;
  }

  // ---------- wiring ----------
  $('btnCpu').addEventListener('click', startLocal);
  $('btnCreate').addEventListener('click', () => startOnline(null));
  $('btnJoin').addEventListener('click', () => startOnline(inviteCode));
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { (inviteCode ? $('btnJoin') : $('btnCreate')).click(); } });
  $('btnCancel').addEventListener('click', goMenu);
  $('btnCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('shareLink').value); } catch (e) { $('shareLink').select(); document.execCommand('copy'); }
    $('btnCopy').textContent = 'Copied!'; setTimeout(() => { $('btnCopy').textContent = 'Copy link'; }, 1500);
  });
  $('btnShare').addEventListener('click', () => navigator.share({ title: 'Badminton', text: `${myName} invites you to a badminton game`, url: $('shareLink').value }).catch(() => {}));
  $('shareLink').addEventListener('focus', (e) => e.target.select());
  $('mute').addEventListener('click', () => { Sound.unlock(); Sound.setMuted(!Sound.muted); $('mute').textContent = Sound.muted ? '🔇' : '🔊'; });
  $('mute').textContent = Sound.muted ? '🔇' : '🔊';
  $('menuBtn').addEventListener('click', () => {
    if (mode === 'menu') return;
    message('Leave this game?', mode === 'online' && seat >= 0 ? 'Leaving ends the game for the other player.' : '', [
      { label: 'Keep playing', secondary: true, onClick: () => show(null) },
      { label: 'Leave', onClick: goMenu },
    ]);
  });

  myName = savedName();
  showNameUI(!myName);
  $('btnChange').addEventListener('click', () => showNameUI(true));
  if (inviteCode) {
    $('joinNote').hidden = false; $('joinCode').textContent = inviteCode;
    $('btnJoin').hidden = false; $('btnCreate').hidden = true;
  }
  $('menuBtn').hidden = true;
  if (!resumeSession()) show('pMenu');
  requestAnimationFrame(frame);

  // No stray selection, caret or focus ring from clicking around, and a clicked button must not keep the keyboard
  // (otherwise pressing Space to hit the shuttle would press that button again).
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('input, select')) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    e.preventDefault();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) b.blur();
    const sel = window.getSelection && window.getSelection();
    if (sel && !e.target.closest('input')) sel.removeAllRanges();
  });
  document.addEventListener('dblclick', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
  document.addEventListener('selectstart', (e) => { if (!e.target.closest || !e.target.closest('input')) e.preventDefault(); });
  document.addEventListener('contextmenu', (e) => { if (e.target === canvas) e.preventDefault(); });

  // add ?fps to the address to see the frame rate and render quality in the corner
  if (/[?&]fps\b/.test(location.search)) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:10px;bottom:34px;font:12px/1.4 monospace;color:#fde68a;background:rgba(0,0,0,.55);padding:4px 8px;border-radius:6px;pointer-events:none;z-index:9';
    document.body.appendChild(box);
    let frames = 0, t0 = performance.now();
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - t0 >= 1000) {
        const s = window.__renderStats || {};
        box.textContent = `${Math.round(frames * 1000 / (now - t0))} fps · draw ${(s.total || 0).toFixed(1)} ms · quality ${Math.round(renderer.quality * 100)}% · ${canvas.width}x${canvas.height}`;
        frames = 0; t0 = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // handy for tests and poking around in the console
  window.__bm = { get game() { return game; }, get view() { return view; }, get mode() { return mode; }, keys };
})();
