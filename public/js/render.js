// Canvas renderer: arena, players, net, the shuttle and all the juice (trail, sparks, shake, floating words).
// The world is in metres, x along the court and y up. draw() is handed an interpolated snapshot every frame.
const Renderer = (() => {
  const W_LEFT = -1.4, W_WIDTH = 16.2, WORLD_H = 10;
  const COURT_W = 13.4, NET_X = 6.7, NET_H = 1.55;
  const SWING_TIME = 0.34;
  const COLORS = [
    { main: '#38bdf8', dark: '#0369a1', band: '#fde047' },
    { main: '#fb923c', dark: '#c2410c', band: '#f8fafc' },
  ];
  const BRAND_A = '#4361ee', BRAND_B = '#7c4dff';   // the nocod.dev gradient
  // seat height (m above the floor) of each tier of the stands, front row first
  const TIERS = [2.35, 2.85, 3.35, 3.85, 4.35];
  const TIER_SCALE = [0.56, 0.5, 0.45, 0.41, 0.37];   // fans higher up are further away, so smaller
  const SKIN = ['#f2c7a0', '#e0ac7e', '#c68642', '#8d5524', '#f6d5b9', '#a56b3d'];
  const HAIR = ['#1f1a24', '#3b2a20', '#6b4423', '#c9a24b', '#8a8a8a', '#2b1d46', '#7a2f2f'];
  const SHIRTS = ['#7c4dff', '#4361ee', '#ec4899', '#f8fafc', '#14b8a6', '#facc15', '#f97316', '#a78bfa', '#38bdf8', '#fb7185', '#34d399'];

  function mix(hex, toHex, a) {
    const h = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const A = h(hex), B = h(toHex);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * a)).join(',')})`;
  }

  // racket arm angle keyframes per shot: [time into swing, angle], angle 0 = straight up, 90 = forward, 180 = down, negative = behind
  const SWINGS = {
    clear: [[0, 60], [0.07, -70], [0.17, 25], [0.34, 135]],
    smash: [[0, 60], [0.08, -110], [0.17, 12], [0.34, 150]],
    drop: [[0, 60], [0.08, 20], [0.17, 80], [0.34, 105]],
    drive: [[0, 60], [0.08, 10], [0.17, 92], [0.34, 130]],
    lift: [[0, 60], [0.06, 190], [0.17, 100], [0.34, 30]],
    serve: [[0, 150], [0.06, 172], [0.17, 110], [0.34, 40]],
  };
  const REST_ARM = 60;
  const SERVE_WAIT_ARM = 150;     // the server waits with the racket hanging below the shuttle

  function armAngle(shot, t) {
    const k = SWINGS[shot] || SWINGS.clear;
    if (t < 0) return REST_ARM;
    for (let i = 1; i < k.length; i++) {
      if (t <= k[i][0]) {
        const u = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
        const e = u * u * (3 - 2 * u);
        return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * e;
      }
    }
    return k[k.length - 1][1];
  }

  function create(canvas) {
    const mainCtx = canvas.getContext('2d', { alpha: false });
    let ctx = mainCtx;
    // the crowd is drawn into its own small layer a few times a second and then blitted: the stands change slowly
    const crowdLayer = document.createElement('canvas');
    let crowdCtx = crowdLayer.getContext('2d');
    let crowdTop = 0, crowdH = 0, crowdLast = -1e9;
    // render quality: scale of the canvas backing store. Lowered automatically if the machine cannot keep up.
    let quality = 1, slowFrames = 0, fastFrames = 0;
    let lod = 0;                    // 0 full faces, 1 plain faces on the back rows, 2 simple fans everywhere
    const crowdFps = () => (lod >= 2 ? 6 : lod === 1 ? 10 : 14);
    let W = 0, H = 0, S = 1, OX = 0, FY = 0, dpr = 1;
    let bg = null;
    const trail = [];
    const particles = [];
    const texts = [];
    const rings = [];
    let shake = 0, flash = 0, netWobble = 0, crowdJump = 0, time = 0;
    let confetti = false;
    const stats = window.__renderStats = { crowd: 0, total: 0 };   // for the performance check in the console
    let gazeX = 6.7, gasp = 0, frameDt = 0.016;   // where the crowd is looking, how startled it is, last frame time
    let crowd = [];

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5) * quality;
      lod = quality >= 0.84 ? 0 : quality >= 0.67 ? 1 : 2;
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      S = Math.min(W / W_WIDTH, H / (H < 520 ? 8 : WORLD_H));   // short screens show less sky above the court, so the court is bigger
      OX = (W - W_WIDTH * S) / 2 - W_LEFT * S;
      FY = Math.round(H * 0.8);
      crowdTop = Math.max(0, Math.floor(FY - (TIERS[TIERS.length - 1] + 2.1) * S));
      crowdH = Math.ceil(FY - 0.85 * S) - crowdTop;
      crowdLayer.width = Math.round(W * dpr); crowdLayer.height = Math.max(1, Math.round(crowdH * dpr));
      crowdCtx = crowdLayer.getContext('2d');
      crowdLast = -1e9;
      buildBackground();
    }
    const sx = (x) => OX + x * S;
    const sy = (y) => FY - y * S;

    function buildBackground() {
      bg = document.createElement('canvas');
      bg.width = Math.round(W * dpr); bg.height = Math.round(H * dpr);
      const g = bg.getContext('2d');
      g.scale(dpr, dpr);
      // back wall: deep violet, lighter towards the floor
      const wall = g.createLinearGradient(0, 0, 0, FY);
      wall.addColorStop(0, '#0b0626'); wall.addColorStop(0.55, '#1b1052'); wall.addColorStop(1, '#2d1a78');
      g.fillStyle = wall; g.fillRect(0, 0, W, FY);
      // a glow of the brand gradient behind the court
      const cx = W / 2, cy = FY - 3.4 * S;
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, 10 * S);
      glow.addColorStop(0, 'rgba(124,77,255,0.42)'); glow.addColorStop(0.6, 'rgba(67,97,238,0.16)'); glow.addColorStop(1, 'rgba(67,97,238,0)');
      g.fillStyle = glow; g.fillRect(0, 0, W, FY);
      // soft out-of-focus lights high up in the hall
      for (let i = 0; i < 46; i++) {
        const x = Math.random() * W, y = Math.random() * (FY - 5 * S), r = (0.1 + Math.random() * 0.28) * S;
        const c = ['196,181,253', '125,160,255', '244,114,182', '255,255,255'][i % 4];
        g.fillStyle = `rgba(${c},${0.05 + Math.random() * 0.08})`;
        g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
      }
      // ceiling lights and their beams
      for (let i = 0; i < 5; i++) {
        const lx = sx(i * 3.35 - 0.1);
        const beam = g.createLinearGradient(0, 0, 0, FY);
        beam.addColorStop(0, 'rgba(226,214,255,0.24)'); beam.addColorStop(1, 'rgba(226,214,255,0)');
        g.fillStyle = beam;
        g.beginPath(); g.moveTo(lx - 0.35 * S, 0); g.lineTo(lx + 0.35 * S, 0); g.lineTo(lx + 1.9 * S, FY); g.lineTo(lx - 1.9 * S, FY); g.closePath(); g.fill();
        g.fillStyle = '#f3ecff'; g.fillRect(lx - 0.45 * S, 0, 0.9 * S, 0.12 * S);
      }
      // floor: a purple court with a soft sheen
      const floor = g.createLinearGradient(0, FY, 0, H);
      floor.addColorStop(0, '#8a5cf0'); floor.addColorStop(0.5, '#5b3bc4'); floor.addColorStop(1, '#33208a');
      g.fillStyle = floor; g.fillRect(0, FY, W, H - FY);
      const sheen = g.createRadialGradient(W / 2, FY, 0, W / 2, FY, W * 0.45);
      sheen.addColorStop(0, 'rgba(255,255,255,0.14)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sheen; g.fillRect(0, FY, W, H - FY);
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
      for (let i = 1; i < 6; i++) { const y = FY + (H - FY) * (i / 6) ** 1.4; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      for (let x = -2; x < 17; x += 0.9) { g.beginPath(); g.moveTo(sx(x), FY); g.lineTo(sx(x) + (sx(x) - W / 2) * 0.25, H); g.stroke(); }
      // court lines on the floor strip
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = Math.max(2, 0.05 * S);
      const yb = FY + (H - FY) * 0.78;
      const lines = [0, NET_X - 1.98, NET_X, NET_X + 1.98, COURT_W];
      for (const x of lines) { g.beginPath(); g.moveTo(sx(x), FY); g.lineTo(sx(x) + (sx(x) - W / 2) * 0.12, yb); g.stroke(); }
      g.beginPath(); g.moveTo(sx(0), FY + 1); g.lineTo(sx(COURT_W), FY + 1); g.stroke();
      g.beginPath(); g.moveTo(sx(0) + (sx(0) - W / 2) * 0.12, yb); g.lineTo(sx(COURT_W) + (sx(COURT_W) - W / 2) * 0.12, yb); g.stroke();
    }

    // A new random crowd for every game (not on every resize, or the fans would jump around mid-rally).
    function layoutCrowd() {
      // Nothing here is regular: every fan has their own size, seat height and spacing, some seats are empty and some
      // friends sit in clusters.
      crowd = [];
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      for (let row = TIERS.length - 1; row >= 0; row--) {
        let x = -1.9 + Math.random() * 0.8;
        while (x < 15.4) {
          const size = TIER_SCALE[row] * (0.74 + Math.random() * 0.56);
          if (Math.random() < 0.66) {
            const r = Math.random();
            crowd.push({
              x, row, size, drop: (Math.random() - 0.5) * 0.3, dim: Math.random() * 0.2,
              ph: Math.random() * 6.28, sp: 0.8 + Math.random() * 0.6,
              shirt: pick(SHIRTS), skin: pick(SKIN), hair: pick(HAIR),
              turn: 0, look: Math.random() * 2 - 1,
              // the face and head are all picked independently, so no two neighbours look alike
              hairStyle: pick(['short', 'short', 'long', 'bald', 'spiky', 'afro', 'bun', 'bob', 'mohawk', 'curly']),
              hw: 0.9 + Math.random() * 0.22, hh: 0.94 + Math.random() * 0.2,
              eyeStyle: pick(['round', 'round', 'big', 'sleepy', 'narrow', 'dot', 'wide']),
              eyeGap: 0.75 + Math.random() * 0.5, eyeH: Math.random() * 0.05 - 0.01,
              brow: pick(['arch', 'flat', 'slant', 'thick', 'none']), browW: 0.022 + Math.random() * 0.03,
              nose: pick(['none', 'curve', 'curve', 'big', 'dot']),
              mouth: pick(['smile', 'smile', 'grin', 'smirk', 'flat', 'open', 'tongue', 'frown']),
              beard: r < 0.12 ? 'mustache' : r < 0.2 ? 'beard' : r < 0.26 ? 'goatee' : r < 0.3 ? 'stubble' : '',
              specs: pick(['', '', '', '', 'round', 'square', 'sun']),
              hat: pick(['', '', '', '', 'cap', 'beanie', 'band', 'party', 'bow']),
              blush: Math.random() < 0.2, freckles: Math.random() < 0.15, cheer: pick(['open', 'open', 'grin', 'shout', 'happy']),
              hand: r < 0.07 ? 'flagA' : r < 0.14 ? 'flagB' : r < 0.26 ? 'phone' : r < 0.31 ? 'foam' : '',
            });
          }
          // uneven spacing: tight pairs, normal gaps, now and then a wide empty stretch
          x += size * 0.5 * (0.7 + Math.random() * 1.8) + (Math.random() < 0.08 ? 0.8 + Math.random() * 1.6 : 0);
        }
      }
    }

    // The stands: five terraces seen from a distance, far ones first. Fans sit and sway, and jump up cheering (arms,
    // flags and phone lights) when `crowdJump` is raised by a point or a smash. Kept dim so the court stays the focus.
    function drawCrowd() {
      const excite = Math.max(0, Math.min(1, crowdJump / 1.1));
      const last = TIERS.length - 1;
      // the dark back of the stands, fading in towards the top so there is no hard edge
      const wallTop = FY - (TIERS[last] + 1.7) * S, wallBottom = FY - 0.9 * S;
      const wall = ctx.createLinearGradient(0, wallTop, 0, wallBottom);
      wall.addColorStop(0, 'rgba(10,5,34,0)'); wall.addColorStop(0.35, 'rgba(10,5,34,0.5)'); wall.addColorStop(1, 'rgba(10,5,34,0.62)');
      ctx.fillStyle = wall; ctx.fillRect(0, wallTop, W, wallBottom - wallTop);
      let idx = 0;
      for (let row = last; row >= 0; row--) {
        const topY = FY - TIERS[row] * S;
        // the terrace step the row sits on
        ctx.fillStyle = 'rgba(20,10,64,0.4)';
        ctx.fillRect(0, topY, W, 0.6 * S);
        ctx.fillStyle = 'rgba(255,255,255,0.045)';
        ctx.fillRect(0, topY, W, Math.max(1, 0.025 * S));
        while (idx < crowd.length && crowd[idx].row === row) {
          const c = crowd[idx++];
          const shade = Math.min(0.92, 0.6 + row * 0.05 + c.dim);
          drawFan(c, topY - c.drop * S, c.size * S, shade, excite);
        }
      }
    }

    const INK = '#190d45';   // comic-book outline colour

    // A fan drawn with a handful of shapes: used on slow machines (and for the back rows when the load is high)
    function drawFanLite(c, seatY, sc, shade, excite) {
      const x = sx(c.x);
      const hop = excite > 0.05 ? Math.abs(Math.sin(time * 9 * c.sp + c.ph)) * excite * 0.2 * sc : 0;
      const base = seatY - hop;
      const shirt = mix(c.shirt, '#0f0a30', shade);
      ctx.fillStyle = shirt;
      ctx.fillRect(x - 0.24 * sc, base - 0.6 * sc, 0.48 * sc, 0.66 * sc);
      if (excite > 0.12) {
        ctx.fillRect(x - 0.34 * sc, base - 1.25 * sc, 0.1 * sc, 0.7 * sc);
        ctx.fillRect(x + 0.24 * sc, base - 1.25 * sc, 0.1 * sc, 0.7 * sc);
      }
      ctx.fillStyle = mix(c.skin, '#0f0a30', shade * 0.8);
      ctx.beginPath(); ctx.arc(x, base - 0.88 * sc, 0.2 * sc, 0, 6.3); ctx.fill();
      ctx.fillStyle = mix(c.hair, '#0f0a30', shade * 0.8);
      ctx.beginPath(); ctx.arc(x, base - 0.92 * sc, 0.2 * sc, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#190d45';
      const look = Math.max(-1, Math.min(1, (gazeX - c.x) / 4.5)) * 0.05 * sc;
      ctx.fillRect(x - 0.09 * sc + look, base - 0.9 * sc, 0.04 * sc, 0.05 * sc);
      ctx.fillRect(x + 0.05 * sc + look, base - 0.9 * sc, 0.04 * sc, 0.05 * sc);
    }

    function drawFan(c, seatY, sc, shade, excite) {
      if (lod >= 2 || (lod === 1 && c.row >= 3) || c.size < 0.5) { drawFanLite(c, seatY, sc, shade, excite); return; }
      // heads follow the shuttle: each fan turns a little behind the others, so a rally ripples across the stands
      const want = Math.max(-1, Math.min(1, (gazeX - c.x) / 4.5)) * 0.95 + Math.sin(time * 0.5 * c.sp + c.ph) * 0.12 * c.look;
      c.turn += (want - c.turn) * Math.min(1, frameDt * (2.5 + c.sp * 3.5));
      const turn = c.turn;
      const dir = Math.sign(turn) || 1;

      const x = sx(c.x);
      const sway = Math.sin(time * 1.6 * c.sp + c.ph) * 0.02 * sc + turn * 0.03 * sc;
      const hop = excite > 0.05 ? Math.abs(Math.sin(time * 9 * c.sp + c.ph)) * excite * 0.2 * sc : 0;
      const base = seatY - hop;
      const shirt = mix(c.shirt, '#0f0a30', shade);
      const skin = mix(c.skin, '#0f0a30', shade * 0.8);
      const hairCol = mix(c.hair, '#0f0a30', shade * 0.8);
      const ink = mix(INK, '#08041c', shade);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';

      // torso, with a stripe so the shirts are not plain blobs
      ctx.fillStyle = shirt; ctx.strokeStyle = ink; ctx.lineWidth = 0.035 * sc;
      ctx.beginPath(); ctx.roundRect(x - 0.25 * sc + sway, base - 0.62 * sc, 0.5 * sc, 0.68 * sc, 0.17 * sc); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x - 0.25 * sc + sway + 0.04 * sc, base - 0.34 * sc, 0.42 * sc, 0.07 * sc);

      // arms: down at rest, thrown up when the crowd is excited
      const up = excite > 0.12 ? Math.min(1, excite * 1.6) : 0;
      const wave = Math.sin(time * 11 * c.sp + c.ph) * 0.35 * up;
      for (const side of [-1, 1]) {
        const sxp = x + side * 0.24 * sc + sway, syp = base - 0.5 * sc;
        const ex = sxp + side * (0.1 + 0.08 * up) * sc + (side * wave) * sc * 0.4;
        const ey = syp + (0.28 - 0.95 * up) * sc;
        ctx.strokeStyle = ink; ctx.lineWidth = 0.17 * sc;
        ctx.beginPath(); ctx.moveTo(sxp, syp); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = shirt; ctx.lineWidth = 0.11 * sc;
        ctx.beginPath(); ctx.moveTo(sxp, syp); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = skin; ctx.lineWidth = 0.03 * sc; ctx.strokeStyle = ink;
        ctx.beginPath(); ctx.arc(ex, ey, 0.075 * sc, 0, 6.3); ctx.fill(); ctx.stroke();
        if (c.hand === 'foam' && side === 1) {          // foam finger
          ctx.fillStyle = mix('#facc15', '#0f0a30', shade);
          ctx.beginPath(); ctx.roundRect(ex - 0.05 * sc, ey - 0.4 * sc, 0.1 * sc, 0.4 * sc, 0.05 * sc); ctx.fill(); ctx.stroke();
        }
      }

      // ----- head -----
      const r = 0.22 * sc;
      const rx = r * c.hw, ry = r * c.hh;
      const hx = x + sway * 1.4 + turn * 0.045 * sc, hy = base - 0.9 * sc;
      const lw = 0.035 * sc;
      const cheering = excite > 0.12, startled = gasp > 0;

      // hair that sits behind the head
      ctx.fillStyle = hairCol; ctx.strokeStyle = ink; ctx.lineWidth = lw;
      if (c.hairStyle === 'afro') { ctx.beginPath(); ctx.arc(hx, hy - 0.04 * sc, r * 1.42, 0, 6.3); ctx.fill(); ctx.stroke(); }
      else if (c.hairStyle === 'long') { ctx.beginPath(); ctx.roundRect(hx - rx * 1.12, hy - ry * 0.4, rx * 2.24, ry * 1.9, 0.1 * sc); ctx.fill(); ctx.stroke(); }
      else if (c.hairStyle === 'bun') { ctx.beginPath(); ctx.arc(hx + turn * 0.04 * sc, hy - ry * 1.18, r * 0.38, 0, 6.3); ctx.fill(); ctx.stroke(); }
      else if (c.hairStyle === 'curly') { for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(hx + k * rx * 0.5, hy - ry * 0.95 + Math.abs(k) * 0.05 * sc, r * 0.4, 0, 6.3); ctx.fill(); ctx.stroke(); } }
      // ear on the side the head is turning away from
      ctx.fillStyle = skin;
      if (Math.abs(turn) > 0.25) { ctx.beginPath(); ctx.arc(hx - dir * rx * 0.98, hy + 0.02 * sc, 0.06 * sc, 0, 6.3); ctx.fill(); ctx.stroke(); }
      // the head itself
      ctx.beginPath(); ctx.ellipse(hx, hy, rx, ry, 0, 0, 6.3); ctx.fill(); ctx.stroke();
      // hair in front
      ctx.fillStyle = hairCol;
      const cap = () => { ctx.beginPath(); ctx.ellipse(hx, hy - 0.02 * sc, rx * 1.02, ry * 1.02, 0, Math.PI * 1.02, Math.PI * 1.98); ctx.fill(); };
      switch (c.hairStyle) {
        case 'short': case 'bun': case 'long': cap(); break;
        case 'bob': cap(); ctx.fillRect(hx - rx * 1.02, hy - 0.04 * sc, 0.08 * sc, ry * 0.9); ctx.fillRect(hx + rx * 1.02 - 0.08 * sc, hy - 0.04 * sc, 0.08 * sc, ry * 0.9); break;
        case 'spiky': cap(); for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(hx + k * rx * 0.42 - rx * 0.2, hy - ry * 0.85); ctx.lineTo(hx + k * rx * 0.42, hy - ry * 1.5); ctx.lineTo(hx + k * rx * 0.42 + rx * 0.2, hy - ry * 0.85); ctx.fill(); } break;
        case 'mohawk': ctx.beginPath(); ctx.moveTo(hx - rx * 0.28, hy - ry * 0.8); ctx.lineTo(hx - rx * 0.1, hy - ry * 1.6); ctx.lineTo(hx + rx * 0.1, hy - ry * 1.45); ctx.lineTo(hx + rx * 0.28, hy - ry * 0.8); ctx.closePath(); ctx.fill(); break;
        case 'afro': ctx.beginPath(); ctx.ellipse(hx, hy - ry * 0.55, rx * 0.95, ry * 0.5, 0, Math.PI, 0); ctx.fill(); break;
        case 'curly': ctx.beginPath(); ctx.ellipse(hx, hy - ry * 0.6, rx * 0.95, ry * 0.4, 0, Math.PI, 0); ctx.fill(); break;
        case 'bald': ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.ellipse(hx - rx * 0.3, hy - ry * 0.6, rx * 0.22, ry * 0.12, -0.5, 0, 6.3); ctx.fill(); break;
        default:
      }

      // ----- face: the features slide across the head as it turns -----
      const fx = hx + turn * rx * 0.5;
      const squash = 1 - Math.abs(turn) * 0.28;
      const ew = 0.085 * sc * squash * c.eyeGap;
      const eyeY = hy + 0.015 * sc + c.eyeH * sc;
      let eR = 0.05 * sc;
      if (c.eyeStyle === 'big') eR = 0.068 * sc; else if (c.eyeStyle === 'wide') eR = 0.058 * sc; else if (c.eyeStyle === 'dot') eR = 0.032 * sc;
      if (startled) eR *= 1.2;
      for (const side of [-1, 1]) {
        const ex = fx + side * ew * (side === Math.sign(turn) ? 1.1 : 0.85);
        const near = side === Math.sign(turn);
        if (c.specs === 'sun') {
          ctx.fillStyle = '#12082e'; ctx.beginPath(); ctx.roundRect(ex - 0.07 * sc, eyeY - 0.045 * sc, 0.14 * sc, 0.09 * sc, 0.03 * sc); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(ex - 0.05 * sc, eyeY - 0.03 * sc, 0.04 * sc, 0.015 * sc);
        } else if (cheering && (c.eyeStyle === 'dot' || c.eyeStyle === 'sleepy' || c.cheer === 'happy')) {
          // happy closed eyes: ^ ^
          ctx.strokeStyle = ink; ctx.lineWidth = 0.032 * sc;
          ctx.beginPath(); ctx.arc(ex, eyeY + 0.025 * sc, 0.04 * sc, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        } else if (c.eyeStyle === 'dot') {
          ctx.fillStyle = ink; ctx.beginPath(); ctx.ellipse(ex + turn * 0.015 * sc, eyeY, eR, eR * 1.25, 0, 0, 6.3); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + turn * 0.015 * sc - eR * 0.3, eyeY - eR * 0.45, eR * 0.3, 0, 6.3); ctx.fill();
        } else {
          const ry2 = c.eyeStyle === 'narrow' ? eR * 0.55 : eR * (cheering ? 0.85 : 1.15);
          ctx.fillStyle = '#fff'; ctx.strokeStyle = ink; ctx.lineWidth = 0.022 * sc;
          ctx.beginPath(); ctx.ellipse(ex, eyeY, eR * 0.9 * (1 - Math.abs(turn) * 0.15) * (near ? 1.08 : 1), ry2, 0, 0, 6.3); ctx.fill(); ctx.stroke();
          const pr = eR * (startled ? 0.36 : c.eyeStyle === 'big' ? 0.62 : 0.5);
          ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(ex + turn * eR * 0.45, eyeY + (startled ? 0 : 0.004 * sc), Math.min(pr, ry2 * 0.95), 0, 6.3); ctx.fill();
          if (c.eyeStyle === 'big') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + turn * eR * 0.45 - pr * 0.3, eyeY - pr * 0.3, pr * 0.28, 0, 6.3); ctx.fill(); }
          if (c.eyeStyle === 'sleepy' && !startled) { ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(ex, eyeY - ry2 * 0.5, eR * 1.0, ry2 * 0.62, 0, Math.PI, 0); ctx.fill(); ctx.strokeStyle = ink; ctx.beginPath(); ctx.moveTo(ex - eR, eyeY - ry2 * 0.1); ctx.lineTo(ex + eR, eyeY - ry2 * 0.1); ctx.stroke(); }
        }
        // eyebrows: raised when cheering or startled, otherwise the fan's own style
        if (c.brow !== 'none') {
          const raise = startled ? 2.2 : cheering ? 1.8 : 1.5;
          const by = eyeY - eR * raise - (c.eyeStyle === 'narrow' ? 0.01 * sc : 0);
          ctx.strokeStyle = mix(c.hair, '#0f0a30', 0.4 + shade * 0.3); ctx.lineWidth = (c.brow === 'thick' ? 0.05 : c.browW) * sc;
          ctx.beginPath();
          const shape = startled || cheering ? 'arch' : c.brow;
          if (shape === 'slant') { ctx.moveTo(ex - side * 0.05 * sc, by - 0.012 * sc); ctx.lineTo(ex + side * 0.05 * sc, by + 0.03 * sc); }
          else if (shape === 'flat' || shape === 'thick') { ctx.moveTo(ex - 0.05 * sc, by); ctx.lineTo(ex + 0.05 * sc, by); }
          else { ctx.moveTo(ex - 0.05 * sc, by + 0.014 * sc); ctx.quadraticCurveTo(ex, by - 0.035 * sc, ex + 0.05 * sc, by + 0.014 * sc); }
          ctx.stroke();
        }
        if (c.specs === 'round' || c.specs === 'square') {
          ctx.strokeStyle = '#1e1b4b'; ctx.lineWidth = 0.026 * sc; ctx.fillStyle = 'rgba(190,210,255,0.12)';
          ctx.beginPath();
          if (c.specs === 'round') ctx.arc(ex, eyeY, eR * 1.6, 0, 6.3); else ctx.roundRect(ex - eR * 1.5, eyeY - eR * 1.35, eR * 3, eR * 2.5, 0.015 * sc);
          ctx.fill(); ctx.stroke();
        }
      }
      if (c.specs) { ctx.strokeStyle = '#1e1b4b'; ctx.lineWidth = 0.024 * sc; ctx.beginPath(); ctx.moveTo(fx - ew * 0.35, eyeY); ctx.lineTo(fx + ew * 0.35, eyeY); ctx.stroke(); }
      if (c.freckles) { ctx.fillStyle = 'rgba(120,60,30,0.5)'; for (const k of [-1, 0, 1]) { ctx.beginPath(); ctx.arc(fx + k * 0.05 * sc - 0.07 * sc, eyeY + 0.09 * sc + Math.abs(k) * 0.01 * sc, 0.011 * sc, 0, 6.3); ctx.arc(fx + k * 0.05 * sc + 0.07 * sc, eyeY + 0.09 * sc + Math.abs(k) * 0.01 * sc, 0.011 * sc, 0, 6.3); ctx.fill(); } }
      if (c.blush) { ctx.fillStyle = 'rgba(255,105,150,0.45)'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(fx + side * ew * 1.6, eyeY + 0.1 * sc, 0.04 * sc, 0.025 * sc, 0, 0, 6.3); ctx.fill(); } }
      // nose
      ctx.strokeStyle = ink; ctx.lineWidth = 0.025 * sc;
      const nx = fx + turn * 0.05 * sc, ny = eyeY + 0.07 * sc;
      if (c.nose === 'big') { ctx.fillStyle = mix(c.skin, '#7a3b2e', 0.25); ctx.beginPath(); ctx.ellipse(nx + dir * 0.012 * sc, ny, 0.035 * sc, 0.03 * sc, 0, 0, 6.3); ctx.fill(); ctx.stroke(); }
      else if (c.nose === 'curve' || Math.abs(turn) > 0.55) { ctx.beginPath(); ctx.moveTo(nx, ny - 0.04 * sc); ctx.quadraticCurveTo(nx + dir * 0.045 * sc, ny + 0.02 * sc, nx, ny + 0.025 * sc); ctx.stroke(); }
      else if (c.nose === 'dot') { ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(nx, ny, 0.014 * sc, 0, 6.3); ctx.fill(); }

      // facial hair, then the mouth on top of it
      const my = hy + 0.11 * sc, mx = fx + turn * 0.015 * sc;
      ctx.fillStyle = hairCol;
      if (c.beard === 'beard') { ctx.beginPath(); ctx.ellipse(hx, hy + ry * 0.62, rx * 0.95, ry * 0.5, 0, 0, Math.PI); ctx.fill(); }
      else if (c.beard === 'goatee') { ctx.beginPath(); ctx.ellipse(mx, hy + ry * 0.82, 0.05 * sc, 0.06 * sc, 0, 0, 6.3); ctx.fill(); }
      else if (c.beard === 'stubble') { ctx.fillStyle = 'rgba(30,20,40,0.28)'; ctx.beginPath(); ctx.ellipse(hx, hy + ry * 0.55, rx * 0.9, ry * 0.5, 0, 0, Math.PI); ctx.fill(); }
      ctx.strokeStyle = ink; ctx.lineWidth = 0.028 * sc; ctx.fillStyle = '#4a0f2e';
      const mouthKind = startled ? 'gasp' : cheering ? (c.cheer === 'shout' ? 'shout' : c.cheer === 'grin' ? 'grin' : 'open') : c.mouth;
      switch (mouthKind) {
        case 'gasp': ctx.beginPath(); ctx.ellipse(mx, my + 0.02 * sc, 0.04 * sc, 0.058 * sc, 0, 0, 6.3); ctx.fill(); ctx.stroke(); break;
        case 'shout': { const o = 0.07 + 0.03 * Math.abs(Math.sin(time * 9 * c.sp + c.ph)); ctx.beginPath(); ctx.ellipse(mx, my + 0.03 * sc, 0.065 * sc, o * sc, 0, 0, 6.3); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#f87171'; ctx.beginPath(); ctx.ellipse(mx, my + 0.055 * sc, 0.04 * sc, 0.025 * sc, 0, 0, 6.3); ctx.fill(); break; }
        case 'open': case 'grin': {
          const dep = (mouthKind === 'grin' ? 0.04 : 0.05 + 0.025 * Math.abs(Math.sin(time * 9 * c.sp + c.ph))) * sc;
          ctx.beginPath(); ctx.moveTo(mx - 0.075 * sc, my - 0.015 * sc); ctx.quadraticCurveTo(mx, my + dep * 2.2, mx + 0.075 * sc, my - 0.015 * sc); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.fillRect(mx - 0.055 * sc, my - 0.012 * sc, 0.11 * sc, 0.02 * sc); break;
        }
        case 'grin2': break;
        case 'smile': ctx.beginPath(); ctx.arc(mx, my - 0.035 * sc, 0.065 * sc, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke(); break;
        case 'smirk': ctx.beginPath(); ctx.moveTo(mx - 0.045 * sc, my + 0.01 * sc); ctx.quadraticCurveTo(mx + 0.02 * sc, my + 0.035 * sc, mx + dir * 0.06 * sc, my - 0.02 * sc); ctx.stroke(); break;
        case 'frown': ctx.beginPath(); ctx.arc(mx, my + 0.06 * sc, 0.05 * sc, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); break;
        case 'tongue': ctx.beginPath(); ctx.arc(mx, my - 0.035 * sc, 0.062 * sc, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); ctx.fillStyle = '#f472b6'; ctx.beginPath(); ctx.ellipse(mx + 0.015 * sc, my + 0.045 * sc, 0.025 * sc, 0.03 * sc, 0, 0, 6.3); ctx.fill(); ctx.stroke(); break;
        case 'grin3': break;
        default: ctx.beginPath(); ctx.moveTo(mx - 0.04 * sc, my + 0.015 * sc); ctx.lineTo(mx + 0.04 * sc, my + 0.015 * sc); ctx.stroke();
      }
      if (c.beard === 'mustache') { ctx.fillStyle = hairCol; ctx.beginPath(); ctx.moveTo(mx - 0.08 * sc, my - 0.01 * sc); ctx.quadraticCurveTo(mx, my - 0.07 * sc, mx + 0.08 * sc, my - 0.01 * sc); ctx.quadraticCurveTo(mx, my - 0.03 * sc, mx - 0.08 * sc, my - 0.01 * sc); ctx.fill(); }

      // hats and headbands
      switch (c.hat) {
        case 'cap': ctx.fillStyle = mix('#7c4dff', '#0f0a30', shade); ctx.beginPath(); ctx.ellipse(hx, hy - 0.04 * sc, rx * 1.05, ry * 1.0, 0, Math.PI, 0); ctx.fill(); ctx.stroke(); ctx.fillRect(hx + dir * 0.02 * sc, hy - 0.07 * sc, dir * 0.3 * sc, 0.05 * sc); break;
        case 'beanie': ctx.fillStyle = mix('#ec4899', '#0f0a30', shade); ctx.beginPath(); ctx.ellipse(hx, hy - 0.05 * sc, rx * 1.05, ry * 1.05, 0, Math.PI, 0); ctx.fill(); ctx.stroke(); ctx.fillStyle = mix('#fff', '#0f0a30', shade); ctx.beginPath(); ctx.arc(hx, hy - ry * 1.12, 0.06 * sc, 0, 6.3); ctx.fill(); ctx.stroke(); break;
        case 'band': ctx.fillStyle = mix('#f97316', '#0f0a30', shade); ctx.fillRect(hx - rx * 1.0, hy - ry * 0.55, rx * 2.0, 0.06 * sc); break;
        case 'party': ctx.fillStyle = mix('#facc15', '#0f0a30', shade); ctx.beginPath(); ctx.moveTo(hx - rx * 0.5, hy - ry * 0.85); ctx.lineTo(hx + 0.03 * sc, hy - ry * 2.0); ctx.lineTo(hx + rx * 0.5, hy - ry * 0.85); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
        case 'bow': ctx.fillStyle = mix('#f472b6', '#0f0a30', shade); for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx + rx * 0.5, hy - ry * 0.95); ctx.lineTo(hx + rx * 0.5 + sd * 0.12 * sc, hy - ry * 1.15); ctx.lineTo(hx + rx * 0.5 + sd * 0.12 * sc, hy - ry * 0.75); ctx.closePath(); ctx.fill(); ctx.stroke(); } break;
        default:
      }

      // flags on a stick and phone lights, when there is something to cheer
      if (c.hand === 'flagA' || c.hand === 'flagB') {
        const col = c.hand === 'flagA' ? COLORS[0].main : COLORS[1].main;
        const px = x + 0.34 * sc + sway, pb = base - 0.45 * sc, pt = base - (1.3 + 0.2 * up) * sc;
        ctx.strokeStyle = mix('#e2e8f0', '#0f0a30', shade); ctx.lineWidth = 0.035 * sc;
        ctx.beginPath(); ctx.moveTo(px, pb); ctx.lineTo(px, pt); ctx.stroke();
        const fl = Math.sin(time * 8 * c.sp + c.ph) * 0.07 * sc;
        ctx.fillStyle = mix(col, '#0f0a30', shade * 0.7); ctx.strokeStyle = ink; ctx.lineWidth = 0.025 * sc;
        ctx.beginPath(); ctx.moveTo(px, pt); ctx.lineTo(px + 0.45 * sc, pt + 0.09 * sc + fl); ctx.lineTo(px, pt + 0.3 * sc); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (c.hand === 'phone' && excite > 0.1 && Math.sin(time * 5 * c.sp + c.ph * 3) > 0.2) {
        const px = x + 0.3 * sc + sway, py = base - (1.0 + 0.2 * up) * sc;
        const gl = ctx.createRadialGradient(px, py, 0, px, py, 0.36 * sc);
        gl.addColorStop(0, 'rgba(255,255,255,0.9)'); gl.addColorStop(1, 'rgba(180,160,255,0)');
        ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(px, py, 0.36 * sc, 0, 6.3); ctx.fill();
      }
    }

    // LED advertising boards along the foot of the stands
    function drawBoards() {
      // a faint LED board at the foot of the stands: just enough to read as a board, never to compete with the game
      const top = FY - 0.92 * S, h = 0.92 * S;
      ctx.fillStyle = 'rgba(80,60,200,0.20)'; ctx.fillRect(0, top, W, h);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(0, top, W, Math.max(1, 0.025 * S));
      ctx.font = `700 ${0.3 * S}px system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      const label = 'NOCOD.DEV   ·   BADMINTON   ·   ';
      const wLabel = ctx.measureText(label).width;
      const off = -((time * 0.08 * S) % wLabel);
      for (let x = off; x < W; x += wLabel) ctx.fillText(label, x, top + h * 0.5);
    }

    // while a serve is pending, light up the part of the floor the server may stand on (behind the short service line)
    function drawServeZone(server) {
      const x0 = server === 0 ? 0 : NET_X + 1.98, x1 = server === 0 ? NET_X - 1.98 : COURT_W;
      const yb = FY + (H - FY) * 0.78;
      // the same slant the court lines on the floor use, so the highlight sits exactly between them
      const bottom = (x) => sx(x) + (sx(x) - W / 2) * 0.12;
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      ctx.fillStyle = `rgba(253,224,71,${0.16 + 0.1 * pulse})`;
      ctx.beginPath();
      ctx.moveTo(sx(x0), FY); ctx.lineTo(sx(x1), FY); ctx.lineTo(bottom(x1), yb); ctx.lineTo(bottom(x0), yb); ctx.closePath();
      ctx.fill();
      // light up the service line the server must stay behind
      const xl = server === 0 ? x1 : x0;
      ctx.strokeStyle = `rgba(253,224,71,${0.7 + 0.3 * pulse})`; ctx.lineWidth = Math.max(3, 0.07 * S); ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(sx(xl), FY); ctx.lineTo(bottom(xl), yb); ctx.stroke();
    }

    // The serve aim: three spots on the opponent's half of the floor (near, mid, far) with the chosen one lit up, a
    // Warning for a smash: while a fast, steeply falling shuttle is on its way down, a red spot shows where it will land.
    function drawLanding(snap) {
      const [x, y, vx, vy] = snap.sh;
      if (snap.ph !== 'rally' || y < 0.35 || vy > -3 || Math.hypot(vx, vy) < 8) return;
      const hit = Sim.predict({ x, y, vx, vy }, 0);
      if (!hit) return;
      const yb = FY + (H - FY) * 0.78, yMid = FY + (yb - FY) * 0.5;
      const cx = sx(hit.x) + (sx(hit.x) - W / 2) * 0.06, pulse = 0.5 + 0.5 * Math.sin(time * 14), rr = (0.55 + 0.08 * pulse) * S;
      ctx.save();
      ctx.lineWidth = 3; ctx.strokeStyle = `rgba(248,113,113,${0.8 + 0.2 * pulse})`; ctx.fillStyle = `rgba(248,113,113,${0.22 + 0.15 * pulse})`;
      ctx.beginPath(); ctx.ellipse(cx, yMid, rr, rr * 0.28, 0, 0, 6.3); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - rr * 0.5, yMid); ctx.lineTo(cx + rr * 0.5, yMid); ctx.moveTo(cx, yMid - rr * 0.14); ctx.lineTo(cx, yMid + rr * 0.14); ctx.stroke();
      ctx.restore();
    }

    // dotted arc showing the flight for the chosen height, and a label. Only the server (and spectators) see it.
    const arcCache = { key: '', pts: null };
    function drawServeAim(snap) {
      const server = snap.sv, [aim, targetX, height] = snap.sa;
      const face = server === 0 ? 1 : -1;
      const yb = FY + (H - FY) * 0.78, yMid = FY + (yb - FY) * 0.5;
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      const floorX = (x) => sx(x) + (sx(x) - W / 2) * 0.12 * 0.5;
      const names = ['NEAR', 'MID', 'FAR'];
      // the flight of the serve, drawn in the side view
      const pl = snap.p[server];
      const sx0 = pl[0] + face * 0.55, sy0 = pl[1] + 1.15;
      const key = `${sx0.toFixed(2)}|${sy0.toFixed(2)}|${face}|${targetX}|${height}`;
      if (arcCache.key !== key) { arcCache.key = key; arcCache.pts = Sim.serveTrajectory(sx0, sy0, face, targetX, height); }
      ctx.save();
      ctx.strokeStyle = `rgba(253,224,71,${0.55 + 0.25 * pulse})`; ctx.lineWidth = Math.max(2, 0.04 * S); ctx.setLineDash([0.12 * S, 0.14 * S]); ctx.lineCap = 'round';
      ctx.beginPath();
      arcCache.pts.forEach((q, i) => { if (i) ctx.lineTo(sx(q.x), sy(q.y)); else ctx.moveTo(sx(q.x), sy(q.y)); });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // the three spots on the floor
      for (let i = 0; i < 3; i++) {
        const x = NET_X + face * Sim.AIM_DIST[i];
        const cx = floorX(x), sel = i === aim;
        const rr = (sel ? Math.max(0.5, Sim.AIM_SPREAD[i] * (height === 0 ? 1.3 : 1)) + 0.05 * pulse : 0.34) * S;   // the lit ring is as wide as the serve may stray
        ctx.lineWidth = sel ? 3 : 2;
        ctx.strokeStyle = sel ? `rgba(253,224,71,${0.85 + 0.15 * pulse})` : 'rgba(255,255,255,0.4)';
        ctx.fillStyle = sel ? `rgba(253,224,71,${0.2 + 0.14 * pulse})` : 'rgba(255,255,255,0.07)';
        ctx.beginPath(); ctx.ellipse(cx, yMid, rr, rr * 0.28, 0, 0, 6.3); ctx.fill(); ctx.stroke();
        if (sel) {
          ctx.beginPath(); ctx.moveTo(cx - rr * 0.55, yMid); ctx.lineTo(cx + rr * 0.55, yMid); ctx.moveTo(cx, yMid - rr * 0.16); ctx.lineTo(cx, yMid + rr * 0.16); ctx.stroke();
          // a line up to where the arc comes down, so the spot and the arc read as one thing
          ctx.save(); ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(253,224,71,0.45)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(sx(targetX), FY); ctx.lineTo(cx, yMid - rr * 0.28); ctx.stroke(); ctx.restore();
        }
        ctx.font = `${sel ? 800 : 600} ${Math.max(10, (sel ? 0.19 : 0.15) * S)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = sel ? '#fde047' : 'rgba(255,255,255,0.5)';
        ctx.fillText(names[i], cx, yMid + rr * 0.28 + 0.22 * S);
      }
      // height label next to the server
      ctx.font = `700 ${Math.max(11, 0.2 * S)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#fde047';
      const ht = ['FLAT & FAST', 'NORMAL', 'HIGH LOB'][height];
      ctx.fillText(ht, sx(pl[0]), sy(2.95));
    }

    function drawNet() {
      const x = sx(NET_X), top = sy(NET_H), bottom = FY;
      // posts
      ctx.fillStyle = '#cfd6e6'; ctx.fillRect(x - 0.05 * S, top - 0.1 * S, 0.1 * S, bottom - top + 0.1 * S);
      // mesh, swaying a little when the shuttle (or a player's racket) disturbs it
      const w = 0.18 * S;
      const wob = (yy) => Math.sin(time * 28 + yy * 0.05) * netWobble * S * 0.07;
      ctx.strokeStyle = 'rgba(235,240,255,0.55)'; ctx.lineWidth = 1;
      const rows = 9, cols = 6;
      for (let i = 0; i <= rows; i++) {
        const yy = top + (bottom - top) * (i / rows);
        ctx.beginPath(); ctx.moveTo(x - w, yy + wob(i * 9)); ctx.lineTo(x + w, yy - wob(i * 9)); ctx.stroke();
      }
      for (let j = 0; j <= cols; j++) {
        const xx = x - w + (2 * w) * (j / cols);
        ctx.beginPath(); ctx.moveTo(xx + wob(j * 30), top); ctx.lineTo(xx - wob(j * 30), bottom); ctx.stroke();
      }
      // white tape on top
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(x - w - 0.04 * S, top - 0.045 * S, 2 * w + 0.08 * S, 0.1 * S);
    }

    function drawShadow(x, y, r, a) {
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.beginPath(); ctx.ellipse(sx(x), FY + 0.2 * S, r * S, r * S * 0.2, 0, 0, 6.3); ctx.fill();
    }

    function limb(x1, y1, x2, y2, w, col) {
      ctx.strokeStyle = col; ctx.lineWidth = w * S; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx(x1), sy(y1)); ctx.lineTo(sx(x2), sy(y2)); ctx.stroke();
    }

    // The racket, drawn in its own frame: head centre at the origin, local +y running back along the arm to the grip.
    function drawRacket(hc, ux, uy, col) {
      ctx.save();
      ctx.translate(sx(hc[0]), sy(hc[1]));
      ctx.rotate(Math.atan2(-uy, ux) + Math.PI / 2);
      const u = S;                          // one metre
      const RX = 0.155 * u, RY = 0.255 * u, L = 0.74;   // L: head centre to the start of the grip
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // grip with tape wrap, from the end of the shaft to the hand
      ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 0.058 * u;
      ctx.beginPath(); ctx.moveTo(0, L * u); ctx.lineTo(0, (L + 0.24) * u); ctx.stroke();
      ctx.strokeStyle = col.band; ctx.lineWidth = Math.max(1, 0.012 * u);
      for (let y = L + 0.01; y < L + 0.23; y += 0.045) { ctx.beginPath(); ctx.moveTo(-0.028 * u, y * u); ctx.lineTo(0.028 * u, (y + 0.03) * u); ctx.stroke(); }
      ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.arc(0, (L + 0.245) * u, 0.034 * u, 0, 6.3); ctx.fill();   // butt cap
      // shaft and throat (the two arms of the Y)
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = Math.max(1.5, 0.026 * u);
      ctx.beginPath(); ctx.moveTo(0, L * u); ctx.lineTo(0, (RY / u + 0.05) * u); ctx.stroke();
      ctx.lineWidth = Math.max(1.5, 0.03 * u); ctx.strokeStyle = col.dark;
      ctx.beginPath(); ctx.moveTo(-0.08 * u, RY - 0.03 * u); ctx.lineTo(0, RY + 0.05 * u); ctx.lineTo(0.08 * u, RY - 0.03 * u); ctx.stroke();
      // string bed, clipped to the head: a fine mesh over a faint tint
      ctx.save();
      ctx.beginPath(); ctx.ellipse(0, 0, RX, RY, 0, 0, 6.3); ctx.clip();
      ctx.fillStyle = 'rgba(226, 238, 255, 0.12)'; ctx.fillRect(-RX, -RY, RX * 2, RY * 2);
      ctx.strokeStyle = 'rgba(235, 242, 255, 0.55)'; ctx.lineWidth = Math.max(0.6, 0.006 * u);
      ctx.beginPath();
      for (let i = -5; i <= 5; i++) { const x = i * 0.028 * u; ctx.moveTo(x, -RY); ctx.lineTo(x, RY); }
      for (let i = -9; i <= 9; i++) { const y = i * 0.028 * u; ctx.moveTo(-RX, y); ctx.lineTo(RX, y); }
      ctx.stroke();
      ctx.restore();
      // frame: dark outline, team colour, then a light highlight on the upper-left edge
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)'; ctx.lineWidth = Math.max(2, 0.036 * u);
      ctx.beginPath(); ctx.ellipse(0, 0, RX, RY, 0, 0, 6.3); ctx.stroke();
      ctx.strokeStyle = col.main; ctx.lineWidth = Math.max(1.4, 0.022 * u);
      ctx.beginPath(); ctx.ellipse(0, 0, RX, RY, 0, 0, 6.3); ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; ctx.lineWidth = Math.max(0.8, 0.007 * u);
      ctx.beginPath(); ctx.ellipse(0, 0, RX - 0.004 * u, RY - 0.004 * u, 0, Math.PI * 1.05, Math.PI * 1.55); ctx.stroke();
      // bumper at the tip of the head
      ctx.strokeStyle = col.band; ctx.lineWidth = Math.max(2, 0.03 * u);
      ctx.beginPath(); ctx.ellipse(0, 0, RX, RY, 0, Math.PI * 1.43, Math.PI * 1.57); ctx.stroke();
      ctx.restore();
    }

    function drawPlayer(p, idx, name, mine, holding) {
      const [x, y, vx, vy, swing, shot] = p;
      const face = idx === 0 ? 1 : -1;
      const col = COLORS[idx];
      drawShadow(x, 0, 0.5 * (1 - Math.min(0.5, y / 6)), 0.28);
      const run = Math.min(1, Math.abs(vx) / 6);
      const cycle = x * 3.3;
      const air = y > 0.02;
      const lean = Math.max(-0.14, Math.min(0.14, vx * 0.022)) + (swing >= 0 ? face * 0.04 : 0);
      const hipY = y + 0.92 - (air ? 0 : Math.abs(Math.sin(cycle)) * 0.03 * run);
      const hipX = x - lean * 0.2;
      // legs
      const legs = [0, 1].map((k) => {
        const ph = cycle + k * Math.PI;
        let fx, fy;
        if (air) { fx = hipX + face * (k ? 0.18 : -0.12) + (k ? 0.1 : -0.1) * 0; fy = y + 0.38 + (k ? 0.08 : 0); }
        else { fx = hipX + Math.sin(ph) * 0.3 * run + (k ? 0.1 : -0.1) * (1 - run); fy = Math.max(0, Math.cos(ph) * 0.14 * run); }
        return [fx, fy];
      });
      // back leg first
      legs.forEach(([fx, fy], k) => {
        const kx = (hipX + fx) / 2 + face * 0.1, ky = (hipY + fy) / 2 + 0.05;
        limb(hipX, hipY, kx, ky, 0.15, k ? col.dark : '#1e293b'); limb(kx, ky, fx, fy + 0.04, 0.13, k ? col.dark : '#1e293b');
        ctx.fillStyle = '#f1f5f9'; ctx.beginPath(); ctx.ellipse(sx(fx + face * 0.06), sy(fy + 0.04), 0.13 * S, 0.06 * S, 0, 0, 6.3); ctx.fill();
      });
      // torso, shorts
      const shX = hipX + lean * 1.1 + face * 0.02, shY = hipY + 0.58;
      limb(hipX, hipY, hipX, hipY + 0.1, 0.27, '#0f172a');
      limb(hipX, hipY + 0.08, shX, shY, 0.34, col.main);
      // head
      const hx = shX + face * 0.03, hy = shY + 0.24;
      ctx.fillStyle = '#f2c7a0'; ctx.beginPath(); ctx.arc(sx(hx), sy(hy), 0.17 * S, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.arc(sx(hx - face * 0.03), sy(hy + 0.04), 0.17 * S, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      ctx.fillStyle = col.band; ctx.fillRect(sx(hx) - 0.17 * S, sy(hy + 0.07), 0.34 * S, 0.06 * S);
      ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(sx(hx + face * 0.09), sy(hy + 0.0), 0.022 * S, 0, 6.3); ctx.fill();
      // arm and racket
      const ang = (holding && swing < 0 ? SERVE_WAIT_ARM : armAngle(shot, swing)) * Math.PI / 180;
      const ax = shX, ay = shY - 0.04;
      const ux = face * Math.sin(ang), uy = Math.cos(ang);
      const hand = [ax + ux * 0.5, ay + uy * 0.5];
      limb(ax, ay, hand[0], hand[1], 0.12, '#f2c7a0');
      limb(ax, ay, (ax + hand[0]) / 2, (ay + hand[1]) / 2, 0.15, col.main);
      const handle = [hand[0] + ux * 0.2, hand[1] + uy * 0.2];
      const hc = [handle[0] + ux * 0.74, handle[1] + uy * 0.74];
      drawRacket(hc, ux, uy, col);
      // a swoosh arc while the racket is moving fast
      if (swing > 0.06 && swing < 0.26) {
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - Math.abs(swing - 0.15) / 0.12)})`; ctx.lineWidth = 0.05 * S;
        ctx.beginPath();
        const a0 = armAngle(shot, swing - 0.05) * Math.PI / 180;
        const r = 1.3;
        for (let i = 0; i <= 6; i++) {
          const a = a0 + (ang - a0) * (i / 6);
          const px = ax + face * Math.sin(a) * r, py = ay + Math.cos(a) * r;
          if (i) ctx.lineTo(sx(px), sy(py)); else ctx.moveTo(sx(px), sy(py));
        }
        ctx.stroke();
      }
      // name tag
      ctx.font = `700 ${Math.max(11, 0.26 * S)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const label = name;
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(8,11,28,0.55)';
      const ty = sy(Math.max(2.15, y + 2.15));
      ctx.beginPath(); ctx.roundRect(sx(x) - tw / 2, ty - 0.27 * S, tw, 0.36 * S, 8); ctx.fill();
      ctx.fillStyle = mine ? '#fde68a' : '#e2e8f0'; ctx.fillText(label, sx(x), ty);
    }

    // Before the serve the shuttle is held along the dotted preview arc: feathers pointing the way it will fly, cork at the back.
    const heldCache = { key: '', ang: 0 };
    function heldAngle(snap) {
      const [, targetX, height] = snap.sa;
      const face = snap.sv === 0 ? 1 : -1, pl = snap.p[snap.sv];
      const x0 = pl[0] + face * 0.55, y0 = pl[1] + 1.15;
      const key = `${x0.toFixed(2)}|${y0.toFixed(2)}|${face}|${targetX}|${height}`;
      if (heldCache.key !== key) {
        heldCache.key = key;
        const pts = Sim.serveTrajectory(x0, y0, face, targetX, height);
        const q = pts[Math.min(4, pts.length - 1)];
        heldCache.ang = pts.length > 1 ? Math.atan2(q.y - pts[0].y, q.x - pts[0].x) + Math.PI : 0;
      }
      return heldCache.ang;
    }

    function drawShuttle(sh) {
      const [x, y, , , ang] = sh;
      ctx.save();
      ctx.translate(sx(x), sy(y));
      ctx.rotate(-ang);
      const k = S * 1.7;
      // skirt of feathers (behind the cork)
      const grad = ctx.createLinearGradient(-0.26 * k, 0, 0, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(1, 'rgba(225,232,245,0.95)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-0.01 * k, -0.045 * k); ctx.lineTo(-0.27 * k, -0.115 * k); ctx.quadraticCurveTo(-0.3 * k, 0, -0.27 * k, 0.115 * k); ctx.lineTo(-0.01 * k, 0.045 * k); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,135,165,0.8)'; ctx.lineWidth = 1;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(-0.02 * k, i * 0.013 * k); ctx.lineTo(-0.27 * k, i * 0.037 * k); ctx.stroke(); }
      ctx.beginPath(); ctx.ellipse(-0.27 * k, 0, 0.012 * k, 0.115 * k, 0, 0, 6.3); ctx.strokeStyle = 'rgba(80,95,130,0.9)'; ctx.lineWidth = 0.014 * k; ctx.stroke();
      // cork
      ctx.fillStyle = '#e9c88f'; ctx.beginPath(); ctx.arc(0.01 * k, 0, 0.055 * k, 0, 6.3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(0.025 * k, -0.02 * k, 0.018 * k, 0, 6.3); ctx.fill();
      ctx.restore();
    }

    function drawTrail(speed) {
      if (trail.length < 2) return;
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1], b = trail[i];
        const u = i / trail.length;
        const hot = Math.min(1, b.s / 28);
        ctx.strokeStyle = `rgba(${255},${Math.round(255 - hot * 110)},${Math.round(255 - hot * 200)},${u * 0.55 * (0.35 + hot)})`;
        ctx.lineWidth = Math.max(1, (0.02 + 0.11 * u * (0.4 + hot)) * S);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx(a.x), sy(a.y)); ctx.lineTo(sx(b.x), sy(b.y)); ctx.stroke();
      }
    }

    function burst(x, y, n, power, colors, spread = 1) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, sp = (1 + Math.random() * 5) * (0.5 + power) * spread;
        particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1, life: 0.4 + Math.random() * 0.5, max: 0.9, size: 0.03 + Math.random() * 0.05, color: colors[Math.floor(Math.random() * colors.length)], g: 9 });
      }
    }

    function word(text, x, y, color, size = 0.5) {
      texts.push({ text, x, y, color, size, age: 0, life: 1.1 });
    }

    function onEvents(events, ctxInfo = {}) {
      for (const e of events) {
        if (e.k === 'hit') {
          burst(e.x, e.y, 5 + Math.round(e.p * 12), e.p, ['#ffffff', '#fde68a', '#fef3c7']);
          rings.push({ x: e.x, y: e.y, age: 0, life: 0.3, max: 0.5 + e.p * 0.9 });
          if (e.t === 'smash') { shake = 0.55; flash = 0.28; crowdJump = Math.max(crowdJump, 0.7); gasp = 0.7; word('SMASH!', e.x, e.y + 0.9, '#fb923c', 0.62); netWobble = Math.max(netWobble, 0.3); }
          else if (e.t === 'drop') word('drop', e.x, e.y + 0.6, '#a7f3d0', 0.34);
          else if (e.t === 'drive') word('drive', e.x, e.y + 0.6, '#bae6fd', 0.34);
        } else if (e.k === 'net') {
          netWobble = 1; gasp = 0.9; burst(e.x, e.y, 8, 0.4, ['#e2e8f0', '#94a3b8']); word('NET!', e.x, e.y + 0.8, '#fca5a5', 0.5);
        } else if (e.k === 'floor') {
          burst(e.x, 0.05, 8, 0.4, ['#e8d3b0', '#caa66f'], 0.7);
        } else if (e.k === 'point') {
          crowdJump = 1.2;
          if (e.why === 'out' || e.why === 'short') gasp = 0.7;
          if (e.why === 'short') word('SHORT!', Math.max(0.5, Math.min(COURT_W - 0.5, ctxInfo.shuttleX || 6.7)), 1.3, '#fde047', 0.55);
          if (e.why === 'out') word('OUT!', Math.max(0.5, Math.min(COURT_W - 0.5, ctxInfo.shuttleX || 6.7)), 1.3, '#fde047', 0.55);
        } else if (e.k === 'over') {
          confetti = true; crowdJump = 3;
          for (let i = 0; i < 90; i++) {
            particles.push({ x: Math.random() * COURT_W, y: 7 + Math.random() * 2, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 3, life: 3 + Math.random() * 1.5, max: 4, size: 0.06 + Math.random() * 0.05, color: ['#f43f5e', '#facc15', '#22c55e', '#3b82f6', '#a855f7'][i % 5], g: 2.5, flutter: true });
          }
        }
      }
    }

    function reset() { layoutCrowd(); crowdLast = -1e9; trail.length = 0; particles.length = 0; texts.length = 0; rings.length = 0; shake = 0; flash = 0; confetti = false; }

    let last = performance.now();
    let last0 = performance.now();
    function draw(snap, meta) {
      const now = performance.now();
      const drawStart = now;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
      // if frames keep taking too long, draw at a lower resolution (the browser scales it back up)
      const rawMs = (now - last0) ;
      last0 = now;
      if (rawMs < 250) {
        if (rawMs > 28) { slowFrames++; fastFrames = 0; } else { fastFrames++; if (rawMs < 20) slowFrames = Math.max(0, slowFrames - 1); }
        if (slowFrames > 45 && quality > 0.5) { quality = Math.max(0.5, quality - 0.17); slowFrames = 0; resize(); }
      }
      frameDt = dt; gasp = Math.max(0, gasp - dt);
      gazeX += ((snap ? snap.sh[0] : 6.7) - gazeX) * Math.min(1, dt * 10);
      shake = Math.max(0, shake - dt * 2.2); flash = Math.max(0, flash - dt * 1.8);
      netWobble = Math.max(0, netWobble - dt * 1.4); crowdJump = Math.max(0, crowdJump - dt * 0.9);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(bg, 0, 0, W, H);
      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
      const tc0 = performance.now();
      if (now - crowdLast > 1000 / crowdFps()) {
        crowdLast = now;
        ctx = crowdCtx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, -crowdTop * dpr);
        ctx.clearRect(0, crowdTop, W, crowdH);
        drawCrowd();
        ctx = mainCtx;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(crowdLayer, 0, Math.round(crowdTop * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stats.crowd = performance.now() - tc0;
      drawBoards();
      if (snap) {
        const sh = snap.sh;
        // shuttle shadow: smaller and fainter the higher it is
        drawShadow(sh[0], 0, 0.22 / (1 + sh[1] * 0.25), 0.3 / (1 + sh[1] * 0.2));
        if (snap.ph === 'serve') drawServeZone(snap.sv);
        drawLanding(snap);
        if (snap.ph === 'serve' && snap.sa && (meta.seat === snap.sv || meta.seat < 0)) drawServeAim(snap);
        drawNet();
        const order = [0, 1];
        for (const i of order) drawPlayer(snap.p[i], i, meta.names[i], meta.seat === i, snap.ph === 'serve' && snap.sv === i);

        // trail follows the shuttle while it flies
        if (snap.ph === 'rally' || snap.ph === 'point') {
          const speed = Math.hypot(sh[2], sh[3]);
          const lastT = trail[trail.length - 1];
          if (!lastT || Math.hypot(lastT.x - sh[0], lastT.y - sh[1]) > 0.03) trail.push({ x: sh[0], y: sh[1], s: speed });
          while (trail.length > 26) trail.shift();
        } else trail.length = 0;
        drawTrail();
        drawShuttle(snap.ph === 'serve' && snap.sa ? [sh[0], sh[1], sh[2], sh[3], heldAngle(snap)] : sh);
        // marker when the shuttle is off the top of the screen
        if (sh[1] > (FY / S) - 0.2) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          const mx = sx(sh[0]);
          ctx.beginPath(); ctx.moveTo(mx, 6); ctx.lineTo(mx - 9, 22); ctx.lineTo(mx + 9, 22); ctx.closePath(); ctx.fill();
          ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${sh[1].toFixed(1)} m`, mx, 38);
        }
      } else drawNet();

      // particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.flutter) { p.vx += Math.sin(time * 6 + i) * 0.05; p.vy = Math.max(p.vy, -1.6); }
        if (p.y < 0 && !p.flutter) { p.y = 0; p.vy *= -0.3; p.vx *= 0.7; }
        ctx.globalAlpha = Math.min(1, p.life / 0.4);
        ctx.fillStyle = p.color;
        ctx.fillRect(sx(p.x) - p.size * S / 2, sy(p.y) - p.size * S / 2, p.size * S, p.size * S * (p.flutter ? 0.6 : 1));
      }
      ctx.globalAlpha = 1;
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.age += dt;
        if (r.age > r.life) { rings.splice(i, 1); continue; }
        const u = r.age / r.life;
        ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - u)})`; ctx.lineWidth = 0.06 * S * (1 - u);
        ctx.beginPath(); ctx.arc(sx(r.x), sy(r.y), (0.15 + u * r.max) * S, 0, 6.3); ctx.stroke();
      }
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i]; t.age += dt;
        if (t.age > t.life) { texts.splice(i, 1); continue; }
        const u = t.age / t.life;
        ctx.globalAlpha = 1 - u * u;
        ctx.font = `900 ${t.size * S * (1 + 0.25 * Math.sin(Math.min(1, u * 4) * 3.14))}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.strokeText(t.text, sx(t.x), sy(t.y + u * 0.8)); ctx.fillStyle = t.color; ctx.fillText(t.text, sx(t.x), sy(t.y + u * 0.8));
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
      stats.total = performance.now() - drawStart;
    }

    layoutCrowd();
    window.addEventListener('resize', resize);
    resize();
    // very large canvases start at a lower resolution; the adaptive logic can still raise or lower it
    if (W * H * dpr * dpr > 3.2e6) { quality = 0.75; resize(); }
    return { draw, onEvents, reset, resize, burst, word, get quality() { return quality; } };
  }

  return { create };
})();
