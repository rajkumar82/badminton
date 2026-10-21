// Canvas renderer: arena, players, net, the shuttle and all the juice (trail, sparks, shake, floating words).
// The world is in metres, x along the court and y up. draw() is handed an interpolated snapshot every frame.
const Renderer = (() => {
  const W_LEFT = -1.4, W_WIDTH = 16.2, WORLD_H = 10;
  const COURT_W = 13.4, NET_X = 6.7, NET_H = 1.55;
  const SWING_TIME = 0.34;
  const COLORS = [
    { main: '#3b82f6', dark: '#1d4ed8', band: '#fde047' },
    { main: '#f97316', dark: '#c2410c', band: '#f8fafc' },
  ];

  // racket arm angle keyframes per shot: [time into swing, angle], angle 0 = straight up, 90 = forward, 180 = down, negative = behind
  const SWINGS = {
    clear: [[0, 60], [0.07, -70], [0.17, 25], [0.34, 135]],
    smash: [[0, 60], [0.08, -110], [0.17, 12], [0.34, 150]],
    drop: [[0, 60], [0.08, 20], [0.17, 80], [0.34, 105]],
    drive: [[0, 60], [0.08, 10], [0.17, 92], [0.34, 130]],
    lift: [[0, 60], [0.06, 190], [0.17, 100], [0.34, 30]],
    serve: [[0, 60], [0.06, 175], [0.17, 110], [0.34, 40]],
  };
  const REST_ARM = 60;

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
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, S = 1, OX = 0, FY = 0, dpr = 1;
    let bg = null;
    const trail = [];
    const particles = [];
    const texts = [];
    const rings = [];
    let shake = 0, flash = 0, netWobble = 0, crowdJump = 0, time = 0;
    let confetti = false;
    let crowd = [];

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      S = Math.min(W / W_WIDTH, H / WORLD_H);
      OX = (W - W_WIDTH * S) / 2 - W_LEFT * S;
      FY = Math.round(H * 0.8);
      buildBackground();
    }
    const sx = (x) => OX + x * S;
    const sy = (y) => FY - y * S;

    function buildBackground() {
      bg = document.createElement('canvas');
      bg.width = Math.round(W * dpr); bg.height = Math.round(H * dpr);
      const g = bg.getContext('2d');
      g.scale(dpr, dpr);
      // back wall
      const wall = g.createLinearGradient(0, 0, 0, FY);
      wall.addColorStop(0, '#10142b'); wall.addColorStop(0.6, '#1d2650'); wall.addColorStop(1, '#2c3a73');
      g.fillStyle = wall; g.fillRect(0, 0, W, FY);
      // sponsor boards along the wall
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, FY - 2.2 * S, W, 0.9 * S);
      g.font = `800 ${0.5 * S}px system-ui, sans-serif`; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,0.10)';
      for (let i = -1; i < 7; i++) g.fillText('NOCOD.DEV   ·   BADMINTON', sx(i * 3.2 - 1.2), FY - 1.75 * S);
      // ceiling lights and their beams
      for (let i = 0; i < 5; i++) {
        const lx = sx(i * 3.35 - 0.1);
        const beam = g.createLinearGradient(0, 0, 0, FY);
        beam.addColorStop(0, 'rgba(255,244,214,0.20)'); beam.addColorStop(1, 'rgba(255,244,214,0)');
        g.fillStyle = beam;
        g.beginPath(); g.moveTo(lx - 0.35 * S, 0); g.lineTo(lx + 0.35 * S, 0); g.lineTo(lx + 1.9 * S, FY); g.lineTo(lx - 1.9 * S, FY); g.closePath(); g.fill();
        g.fillStyle = '#fff4d6'; g.fillRect(lx - 0.45 * S, 0, 0.9 * S, 0.12 * S);
      }
      // floor
      const floor = g.createLinearGradient(0, FY, 0, H);
      floor.addColorStop(0, '#d9a066'); floor.addColorStop(1, '#8a5a2c');
      g.fillStyle = floor; g.fillRect(0, FY, W, H - FY);
      g.strokeStyle = 'rgba(80,40,10,0.18)'; g.lineWidth = 1;
      for (let i = 1; i < 6; i++) { const y = FY + (H - FY) * (i / 6) ** 1.4; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      for (let x = -2; x < 17; x += 0.9) { g.beginPath(); g.moveTo(sx(x), FY); g.lineTo(sx(x) + (sx(x) - W / 2) * 0.25, H); g.stroke(); }
      // court lines on the floor strip
      g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = Math.max(2, 0.05 * S);
      const yb = FY + (H - FY) * 0.78;
      const lines = [0, 1.98 + NET_X - 1.98 - 0, NET_X - 1.98, NET_X, NET_X + 1.98, COURT_W].filter((v, i, a) => a.indexOf(v) === i);
      for (const x of lines) { g.beginPath(); g.moveTo(sx(x), FY); g.lineTo(sx(x) + (sx(x) - W / 2) * 0.12, yb); g.stroke(); }
      g.beginPath(); g.moveTo(sx(0), FY + 1); g.lineTo(sx(COURT_W), FY + 1); g.stroke();
      g.beginPath(); g.moveTo(sx(0) + (sx(0) - W / 2) * 0.12, yb); g.lineTo(sx(COURT_W) + (sx(COURT_W) - W / 2) * 0.12, yb); g.stroke();
      // the crowd, drawn live (see drawCrowd) but laid out once
      crowd = [];
      const palette = ['#7c8bd1', '#c47ad1', '#d1a37c', '#7cd1b4', '#d17c7c', '#9aa3c7', '#e6c15a'];
      for (let row = 0; row < 2; row++) {
        for (let x = -1.6; x < 15; x += 0.62 + Math.random() * 0.25) {
          crowd.push({ x: x + (row ? 0.3 : 0), row, c: palette[Math.floor(Math.random() * palette.length)], ph: Math.random() * 6.28, h: 0.5 + Math.random() * 0.12 });
        }
      }
    }

    function drawCrowd() {
      for (const c of crowd) {
        const base = FY - (c.row ? 2.45 : 2.05) * S;
        const bob = Math.sin(time * 2 + c.ph) * 0.02 * S + (crowdJump > 0 ? Math.abs(Math.sin(time * 14 + c.ph)) * crowdJump * 0.28 * S : 0);
        const x = sx(c.x), y = base - bob;
        ctx.fillStyle = c.row ? 'rgba(20,24,52,0.9)' : 'rgba(30,36,72,0.95)';
        ctx.beginPath(); ctx.arc(x, y - c.h * S * 0.6, 0.17 * S, 0, 6.3); ctx.fill();
        ctx.fillStyle = c.c; ctx.globalAlpha = 0.45;
        ctx.beginPath(); ctx.arc(x, y - c.h * S * 0.6, 0.17 * S, 0, 6.3); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(15,18,40,0.8)';
        ctx.beginPath(); ctx.ellipse(x, y + 0.2 * S, 0.27 * S, 0.33 * S, 0, 0, 6.3); ctx.fill();
      }
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

    function drawPlayer(p, idx, name, mine) {
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
      const ang = armAngle(shot, swing) * Math.PI / 180;
      const ax = shX, ay = shY - 0.04;
      const ux = face * Math.sin(ang), uy = Math.cos(ang);
      const hand = [ax + ux * 0.5, ay + uy * 0.5];
      limb(ax, ay, hand[0], hand[1], 0.12, '#f2c7a0');
      limb(ax, ay, (ax + hand[0]) / 2, (ay + hand[1]) / 2, 0.15, col.main);
      const handle = [hand[0] + ux * 0.2, hand[1] + uy * 0.2];
      limb(hand[0], hand[1], handle[0], handle[1], 0.035, '#111827');
      const hc = [handle[0] + ux * 0.34, handle[1] + uy * 0.34];
      // the head of the racket, tilted along the arm direction
      ctx.save();
      ctx.translate(sx(hc[0]), sy(hc[1]));
      ctx.rotate(Math.atan2(-uy, ux) + Math.PI / 2);
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.035 * S;
      ctx.beginPath(); ctx.ellipse(0, 0, 0.15 * S, 0.22 * S, 0, 0, 6.3); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 0.05 * S, -0.2 * S); ctx.lineTo(i * 0.05 * S, 0.2 * S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-0.14 * S, i * 0.07 * S); ctx.lineTo(0.14 * S, i * 0.07 * S); ctx.stroke(); }
      ctx.restore();
      // a swoosh arc while the racket is moving fast
      if (swing > 0.06 && swing < 0.26) {
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - Math.abs(swing - 0.15) / 0.12)})`; ctx.lineWidth = 0.05 * S;
        ctx.beginPath();
        const a0 = armAngle(shot, swing - 0.05) * Math.PI / 180;
        const r = 1.05;
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
      const label = mine ? `${name} (you)` : name;
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(8,11,28,0.55)';
      const ty = sy(Math.max(2.15, y + 2.15));
      ctx.beginPath(); ctx.roundRect(sx(x) - tw / 2, ty - 0.27 * S, tw, 0.36 * S, 8); ctx.fill();
      ctx.fillStyle = mine ? '#fde68a' : '#e2e8f0'; ctx.fillText(label, sx(x), ty);
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
          if (e.t === 'smash') { shake = 0.55; flash = 0.28; word('SMASH!', e.x, e.y + 0.9, '#fb923c', 0.62); netWobble = Math.max(netWobble, 0.3); }
          else if (e.t === 'drop') word('drop', e.x, e.y + 0.6, '#a7f3d0', 0.34);
          else if (e.t === 'drive') word('drive', e.x, e.y + 0.6, '#bae6fd', 0.34);
        } else if (e.k === 'net') {
          netWobble = 1; burst(e.x, e.y, 8, 0.4, ['#e2e8f0', '#94a3b8']); word('NET!', e.x, e.y + 0.8, '#fca5a5', 0.5);
        } else if (e.k === 'floor') {
          burst(e.x, 0.05, 8, 0.4, ['#e8d3b0', '#caa66f'], 0.7);
        } else if (e.k === 'point') {
          crowdJump = 1.2;
          if (e.why === 'out') word('OUT!', Math.max(0.5, Math.min(COURT_W - 0.5, ctxInfo.shuttleX || 6.7)), 1.3, '#fde047', 0.55);
        } else if (e.k === 'over') {
          confetti = true; crowdJump = 3;
          for (let i = 0; i < 90; i++) {
            particles.push({ x: Math.random() * COURT_W, y: 7 + Math.random() * 2, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 3, life: 3 + Math.random() * 1.5, max: 4, size: 0.06 + Math.random() * 0.05, color: ['#f43f5e', '#facc15', '#22c55e', '#3b82f6', '#a855f7'][i % 5], g: 2.5, flutter: true });
          }
        }
      }
    }

    function reset() { trail.length = 0; particles.length = 0; texts.length = 0; rings.length = 0; shake = 0; flash = 0; confetti = false; }

    let last = performance.now();
    function draw(snap, meta) {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
      shake = Math.max(0, shake - dt * 2.2); flash = Math.max(0, flash - dt * 1.8);
      netWobble = Math.max(0, netWobble - dt * 1.4); crowdJump = Math.max(0, crowdJump - dt * 0.9);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(bg, 0, 0, W, H);
      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
      drawCrowd();
      if (snap) {
        const sh = snap.sh;
        // shuttle shadow: smaller and fainter the higher it is
        drawShadow(sh[0], 0, 0.22 / (1 + sh[1] * 0.25), 0.3 / (1 + sh[1] * 0.2));
        drawNet();
        const order = [0, 1];
        for (const i of order) drawPlayer(snap.p[i], i, meta.names[i], meta.seat === i);

        // trail follows the shuttle while it flies
        if (snap.ph === 'rally' || snap.ph === 'point') {
          const speed = Math.hypot(sh[2], sh[3]);
          const lastT = trail[trail.length - 1];
          if (!lastT || Math.hypot(lastT.x - sh[0], lastT.y - sh[1]) > 0.03) trail.push({ x: sh[0], y: sh[1], s: speed });
          while (trail.length > 26) trail.shift();
        } else trail.length = 0;
        drawTrail();
        drawShuttle(sh);
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
    }

    window.addEventListener('resize', resize);
    resize();
    return { draw, onEvents, reset, resize, burst, word };
  }

  return { create };
})();
