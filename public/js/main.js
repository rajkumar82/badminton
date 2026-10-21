// Game flow: menu, name prompt, play vs computer (local sim), play online (server sim over a WebSocket), spectating.
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const renderer = Renderer.create(canvas);
  const DT = Sim.DT;
  const LEVEL_NAMES = ['Easy', 'Medium', 'Hard'];

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
  const keys = { left: false, right: false, jump: false, smash: false, drop: false, normal: false, hit: false };

  const inviteCode = (new URLSearchParams(location.search).get('g') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  // ---------- panels ----------
  function show(panel) {
    $('overlay').classList.toggle('hidden', !panel);
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
    history.replaceState(null, '', location.pathname);
    $('joinNote').hidden = true; $('btnJoin').hidden = true; $('btnCreate').hidden = false;
    show('pMenu');
  }

  // ---------- name ----------
  function getName() {
    const n = $('name').value.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14);
    if (!n) {
      $('name').focus();
      $('nameErr').hidden = false;
      return null;
    }
    $('nameErr').hidden = true;
    try { localStorage.setItem('bm-name', n); } catch (e) { /* ignore */ }
    myName = n;
    return n;
  }

  // ---------- local game against the computer ----------
  function startLocal() {
    const n = getName(); if (!n) return;
    Sound.unlock(); Sound.blip();
    const level = Number($('level').value);
    mode = 'local'; seat = 0; role = 'player';
    names = [n, `Computer (${LEVEL_NAMES[level]})`];
    game = new Sim.Game();
    bot = new AI.Bot(1, level);
    acc = 0; renderer.reset(); lastPhase = ''; lastScore = '0-0';
    $('hud').hidden = false; $('menuBtn').hidden = false; show(null);
    updateNames();
  }

  // ---------- online ----------
  function connect(first) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify(first));
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onServer(m); };
    ws.onclose = () => {
      if (mode === 'online' && ws) { ws = null; message('Connection lost', 'The connection to the game server was closed.', [{ label: 'Back to menu', onClick: goMenu }]); }
      else if (mode === 'connecting') { ws = null; mode = 'menu'; message('Could not connect', 'The game server did not answer. Please try again.', [{ label: 'Back to menu', onClick: goMenu }]); }
    };
  }

  function leaveOnline() {
    if (ws) { const s = ws; ws = null; try { s.send(JSON.stringify({ t: 'leave' })); s.close(); } catch (e) { /* closed */ } }
  }

  function startOnline(code) {
    const n = getName(); if (!n) return;
    Sound.unlock(); Sound.blip();
    mode = 'connecting';
    show(null);
    connect(code ? { t: 'join', code, name: n } : { t: 'create', name: n });
  }

  function link() { return `${location.origin}/?g=${room.code}`; }

  function onServer(m) {
    switch (m.t) {
      case 'joined':
        mode = 'online'; role = m.role; seat = m.seat; room = m.room; names = room.names.slice();
        renderer.reset(); buffer = []; view = null; rematchSent = false; lastPhase = ''; lastScore = '0-0';
        $('hud').hidden = false; $('menuBtn').hidden = false; updateNames();
        if (role === 'player' && !room.started) {
          $('shareLink').value = link();
          $('btnShare').hidden = !navigator.share;
          show('pWait');
        } else show(null);
        break;
      case 'start':
        room = m.room; names = room.names.slice(); updateNames();
        renderer.reset(); buffer = []; rematchSent = false; lastPhase = ''; lastScore = '0-0';
        show(null);
        break;
      case 'room': room = m.room; break;
      case 'snap': {
        buffer.push({ t: performance.now(), s: m.s });
        if (buffer.length > 12) buffer.shift();
        handleEvents(m.s.ev, m.s);
        break;
      }
      case 'rematch':
        if (m.who !== seat) $('sub').textContent = `${names[m.who]} wants a rematch`;
        break;
      case 'ended': {
        const s = ws; ws = null; if (s) s.close();
        const why = m.why === 'left' ? `${m.who || 'A player'} left the game.` : 'This game was closed.';
        message('Game ended', why, [{ label: 'Back to menu', onClick: goMenu }]);
        break;
      }
      case 'error': {
        const s = ws; ws = null; if (s) s.close();
        mode = 'menu';
        message(m.code === 'nogame' ? 'Game not found' : 'Oops', m.msg, [
          { label: 'Start a new game', onClick: () => { history.replaceState(null, '', location.pathname); goMenu(); } },
        ]);
        break;
      }
      default:
    }
  }

  // ---------- input ----------
  const KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', KeyW: 'jump',
    KeyS: 'smash', KeyD: 'drop', KeyA: 'normal',
    Space: 'hit', Enter: 'hit',
  };
  function sendInput() {
    if (mode === 'local' && game) game.setInput(0, keys);
    else if (mode === 'online' && ws && seat >= 0 && ws.readyState === 1) ws.send(JSON.stringify({ t: 'input', ...keys }));
  }
  function setKey(code, down) {
    const k = KEYMAP[code];
    if (!k || keys[k] === down) return false;
    keys[k] = down; sendInput(); return true;
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
      if (e.k === 'hit') Sound.hit(e.t, e.p, e.x);
      else if (e.k === 'swing') Sound.swing(e.x);
      else if (e.k === 'net') Sound.net(e.p, e.x);
      else if (e.k === 'floor') Sound.floor(e.p, e.x);
      else if (e.k === 'jump') Sound.jump(e.x);
      else if (e.k === 'land') Sound.land(e.x);
      else if (e.k === 'point') Sound.point(seat < 0 ? true : e.w === seat);
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
      sub.textContent = s.sv === seat ? 'Your serve: press SPACE' : `${names[s.sv]} to serve`;
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
    const rt = performance.now() - 55;
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

  // ---------- main loop ----------
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
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
    renderer.draw(mode === 'menu' || mode === 'connecting' ? idleScene(now) : view, { names, seat });
    requestAnimationFrame(frame);
  }

  // a calm scene behind the menu: the shuttle bobbing above the net
  function idleScene(now) {
    const t = now / 1000;
    return {
      ph: 'serve', sc: [0, 0], sv: 0, w: -1, gp: -1, lh: -1,
      p: [[3.2 + Math.sin(t * 0.6) * 0.6, 0, 0, 0, -1, 'clear'], [10.2 - Math.sin(t * 0.5) * 0.6, 0, 0, 0, -1, 'clear']],
      sh: [6.7 + Math.sin(t * 0.9) * 0.5, 3.3 + Math.sin(t * 1.7) * 0.3, 0, 0, 0.9 + Math.sin(t) * 0.2],
    };
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

  try { $('name').value = localStorage.getItem('bm-name') || ''; } catch (e) { /* ignore */ }
  if (inviteCode) {
    $('joinNote').hidden = false; $('joinCode').textContent = inviteCode;
    $('btnJoin').hidden = false; $('btnCreate').hidden = true;
  }
  $('menuBtn').hidden = true;
  show('pMenu');
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

  // handy for tests and poking around in the console
  window.__bm = { get game() { return game; }, get view() { return view; }, get mode() { return mode; }, keys };
})();
