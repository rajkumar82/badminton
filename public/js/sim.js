// Badminton simulation, shared by the server (online games) and the browser (play vs computer).
// Side view: x runs along the court (metres, 0..COURT_W), y is height above the floor. Player 0 is on the
// left and faces right, player 1 on the right and faces left. Everything here is deterministic given the inputs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const COURT_W = 13.4;
  const NET_X = COURT_W / 2;
  const NET_H = 1.55;
  const BACK_ROOM = 1.0;         // how far behind the back line a player may stand
  const SMASH_CLEARANCE = 0.7;   // a smash is aimed this far above the net tape
  const AIM_DIST = [1.6, 3.4, 5.4];      // where a serve lands, metres past the net: near, mid, far
  const SERVE_ANGLES = [                  // launch angles tried (flattest first) for a low, normal and high serve
    [26, 30, 34, 38, 42, 46],
    [40, 44, 48, 52, 56, 60],
    [60, 64, 68, 72, 76],
  ];
  const SERVICE_LINE = 1.98;     // short service line, metres from the net
  const DT = 1 / 120;           // fixed physics step
  const GRAVITY = 9.8;          // shuttle
  const DRAG = 0.2;             // quadratic drag: terminal velocity = sqrt(g / k), about 7 m/s like a real shuttle
  const PLAYER_G = 22;
  const MOVE_SPEED = 6.4;
  const MOVE_ACC = 70;
  const JUMP_V = 7.0;
  const SWING_TIME = 0.34;      // whole swing
  const HIT_FROM = 0.07;        // the racket can connect between these two moments of the swing
  const HIT_TO = 0.27;
  const SWING_COOLDOWN = 0.12;
  const REACH = 1.2;            // radius of the racket's hitting zone
  const POINT_PAUSE = 1.6;
  const WIN_SCORE = 15;
  const WIN_BY = 2;

  // Shot recipes: launch speed (m/s) and angle above the horizontal (degrees). Tuned with test/tune.js.
  const SHOTS = {
    clear: { speed: 24, angle: 52 },
    drive: { speed: 23, angle: 8 },
    drop: { speed: 8.5, angle: 26 },
    smash: { speed: 35, angle: -21 },
    lift: { speed: 23.5, angle: 62 },
    serve: { speed: 9, angle: 45 },
  };

  function newPlayer(idx) {
    return { idx, x: idx === 0 ? 2.2 : COURT_W - 2.2, y: 0, vx: 0, vy: 0, face: idx === 0 ? 1 : -1, swing: -1, cooldown: 0, hitDone: false, shot: 'clear' };
  }

  class Game {
    constructor(opts = {}) {
      this.target = opts.target || WIN_SCORE;
      this.reset(opts.server || 0);
    }

    reset(server) {
      this.players = [newPlayer(0), newPlayer(1)];
      this.inputs = [blankInput(), blankInput()];
      this.prevHit = [false, false];
      this.score = [0, 0];
      this.server = server;
      this.serveAim = [1, 1];      // each player's chosen serve length: 0 near, 1 mid, 2 far
      this.winner = -1;
      this.phase = 'serve';       // serve | rally | point | over
      this.phaseTime = 0;
      this.lastHitter = -1;
      this.rallyHits = 0;
      this.time = 0;
      this.events = [];
      this.shuttle = { x: 0, y: 0, vx: 0, vy: 0, ang: 0, angVel: 0, speed: 0 };
      this.holdShuttle();
    }

    setInput(idx, input) {
      const i = this.inputs[idx];
      i.left = !!input.left; i.right = !!input.right; i.jump = !!input.jump;
      i.smash = !!input.smash; i.drop = !!input.drop; i.normal = !!input.normal;
      if (input.far && !i.far) i.farQ = true;      // a tap shorter than one physics step must still count
      if (input.near && !i.near) i.nearQ = true;
      i.far = !!input.far; i.near = !!input.near;
      if (input.hit && !i.hit) i.hitQueued = true; // a tap shorter than one physics step must still count
      i.hit = !!input.hit;
    }

    holdShuttle() {
      const p = this.players[this.server];
      const s = this.shuttle;
      s.x = p.x + p.face * 0.55; s.y = p.y + 1.15; s.vx = 0; s.vy = 0; s.speed = 0;
      s.ang = p.face > 0 ? 0.9 : Math.PI - 0.9; s.angVel = 0;
    }

    step(dt = DT) {
      this.time += dt;
      this.phaseTime += dt;
      for (const p of this.players) this.stepPlayer(p, dt);
      if (this.phase === 'serve') this.holdShuttle();
      else if (this.phase === 'rally') this.stepShuttle(dt);
      else if (this.phase === 'point') {
        this.stepShuttle(dt);
        if (this.phaseTime >= POINT_PAUSE) {
          this.phase = 'serve'; this.phaseTime = 0; this.lastHitter = -1; this.rallyHits = 0;
          for (const p of this.players) { p.swing = -1; p.hitDone = false; }
          this.holdShuttle();
        }
      }
    }

    stepPlayer(p, dt) {
      const inp = this.inputs[p.idx];
      const frozen = this.phase === 'over';
      const dir = frozen ? 0 : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const target = dir * MOVE_SPEED;
      const dv = target - p.vx;
      const maxDv = MOVE_ACC * dt;
      p.vx += Math.abs(dv) <= maxDv ? dv : Math.sign(dv) * maxDv;
      p.x += p.vx * dt;
      // players may step behind the back line (to reach shuttles that land near it), but only so far
      let lo = p.idx === 0 ? -BACK_ROOM : NET_X + 0.45;
      let hi = p.idx === 0 ? NET_X - 0.45 : COURT_W + BACK_ROOM;
      // until the serve is struck the server has to stay behind the short service line; the receiver may go anywhere
      if (this.phase === 'serve' && p.idx === this.server) {
        if (p.idx === 0) hi = NET_X - SERVICE_LINE; else lo = NET_X + SERVICE_LINE;
      }
      if (p.x < lo) { p.x = lo; p.vx = Math.max(p.vx, 0); }
      if (p.x > hi) { p.x = hi; p.vx = Math.min(p.vx, 0); }

      const serving = this.phase === 'serve' && p.idx === this.server;
      if (serving) {
        if (inp.farQ && this.serveAim[p.idx] < 2) { this.serveAim[p.idx]++; this.events.push({ k: 'aim', i: p.idx, a: this.serveAim[p.idx] }); }
        if (inp.nearQ && this.serveAim[p.idx] > 0) { this.serveAim[p.idx]--; this.events.push({ k: 'aim', i: p.idx, a: this.serveAim[p.idx] }); }
      }
      inp.farQ = false; inp.nearQ = false;
      if (p.y === 0 && p.vy === 0 && inp.jump && !frozen && !serving) { p.vy = JUMP_V; this.events.push({ k: 'jump', x: p.x, i: p.idx }); }
      if (p.y > 0 || p.vy > 0) {
        p.vy -= PLAYER_G * dt;
        p.y += p.vy * dt;
        if (p.y <= 0) { p.y = 0; p.vy = 0; this.events.push({ k: 'land', x: p.x, i: p.idx }); }
      }

      if (p.cooldown > 0) p.cooldown -= dt;
      const pressed = inp.hitQueued || (inp.hit && !this.prevHit[p.idx]);
      inp.hitQueued = false;
      this.prevHit[p.idx] = inp.hit;
      if (pressed && p.swing < 0 && p.cooldown <= 0 && !frozen && this.phase !== 'point') {
        p.swing = 0; p.hitDone = false;
        p.shot = this.pickShot(p);
        this.events.push({ k: 'swing', x: p.x, y: p.y, i: p.idx });
      }
      if (p.swing >= 0) {
        p.swing += dt;
        if (p.swing < HIT_FROM) { p.shot = this.pickShot(p); p.serveH = this.serveHeight(p.idx); }
        if (p.swing >= HIT_FROM && p.swing <= HIT_TO && !p.hitDone) this.tryHit(p);
        if (p.swing >= SWING_TIME) { p.swing = -1; p.cooldown = SWING_COOLDOWN; }
      }
    }

    // The kind of shot comes from the keys held with the swing: S smash, D drop, A normal return. With none of them
    // a low shuttle is lifted, forward gives a flat drive and anything else is a clear. Decided from the keys held
    // during the first moments of the swing, so S + Space pressed almost together still works.
    pickShot(p) {
      const inp = this.inputs[p.idx];
      const s = this.shuttle;
      if (this.phase === 'serve' && p.idx === this.server) return 'serve';
      if (inp.smash) return 'smash';
      if (inp.drop) return 'drop';
      if (s.y < 0.9) return 'lift';
      if (inp.normal) return 'clear';
      const forward = p.face > 0 ? inp.right : inp.left;
      return forward ? 'drive' : 'clear';
    }

    serveHeight(idx) {
      const i = this.inputs[idx];
      return i.smash ? 0 : i.drop ? 2 : 1;
    }

    hitCentre(p) {
      return { x: p.x + p.face * 0.45, y: p.y + 1.6 };
    }

    tryHit(p) {
      const s = this.shuttle;
      if (this.phase === 'serve') {
        if (p.idx !== this.server) return;
        p.hitDone = true;
        this.launch(p, 'serve');
        this.lastHitter = p.idx;   // the server may not hit their own serve again
        this.rallyHits = 1;
        this.phase = 'rally'; this.phaseTime = 0;
        this.events.push({ k: 'hit', t: 'serve', x: s.x, y: s.y, p: 0.3, i: p.idx });
        return;
      }
      if (this.phase !== 'rally' || this.lastHitter === p.idx) return;
      const c = this.hitCentre(p);
      if (Math.hypot(s.x - c.x, s.y - c.y) > REACH) return;
      // can't reach over the net
      if (p.idx === 0 ? s.x > NET_X + 0.25 : s.x < NET_X - 0.25) return;
      p.hitDone = true;
      let type = p.shot;
      if (type === 'smash' && s.y < p.y + 1.3) type = 'clear'; // contact point too low to smash
      this.launch(p, type);
      this.lastHitter = p.idx;
      this.rallyHits++;
      const power = Math.min(1, SHOTS[type].speed / 40);
      this.events.push({ k: 'hit', t: type, x: s.x, y: s.y, p: power, i: p.idx });
    }

    launch(p, type) {
      const s = this.shuttle;
      const shot = { speed: SHOTS[type].speed, angle: SHOTS[type].angle };
      if (type === 'serve') {
        const sv = serveShot(s.x, s.y, p.face, NET_X + p.face * AIM_DIST[this.serveAim[p.idx]], p.serveH === undefined ? 1 : p.serveH);
        shot.speed = sv.speed; shot.angle = sv.angle;
      }
      else if (type === 'drive') shot.speed = speedToLand(s.x, s.y, p.face, shot.angle, NET_X + p.face * 5.4, 12, 34);
      let a = shot.angle * Math.PI / 180;
      if (type === 'smash') {
        // aim just over the tape: steep when hitting close to the net, flatter from further back
        const toNet = Math.max(0.35, Math.abs(NET_X - s.x));
        a = Math.max(-0.6, Math.min(-0.04, Math.atan2(NET_H + SMASH_CLEARANCE - s.y, toNet) + 0.05));
      }
      // the shuttle was flying cork-first towards the racket; the spring in stepShuttle flips it round after the hit
      s.ang = s.speed > 1 ? Math.atan2(s.vy, s.vx) : s.ang;
      s.vx = p.face * shot.speed * Math.cos(a) + p.vx * 0.25;
      s.vy = shot.speed * Math.sin(a);
      s.speed = Math.hypot(s.vx, s.vy);
      s.angVel = 0;
    }

    stepShuttle(dt) {
      const s = this.shuttle;
      const px = s.x, py = s.y;
      const sp = Math.hypot(s.vx, s.vy);
      s.vx += -DRAG * sp * s.vx * dt;
      s.vy += (-GRAVITY - DRAG * sp * s.vy) * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.speed = Math.hypot(s.vx, s.vy);

      // heading: spring towards the direction of travel (cork leads), so a fresh hit visibly flips the shuttle round
      if (s.speed > 0.5) {
        const want = Math.atan2(s.vy, s.vx);
        let d = want - s.ang;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        s.angVel += (d * 1100 - s.angVel * 38) * dt;
        s.ang += s.angVel * dt;
      }

      if (this.phase === 'rally' && (px - NET_X) * (s.x - NET_X) < 0) {
        const t = (NET_X - px) / (s.x - px);
        const yAt = py + (s.y - py) * t;
        if (yAt < NET_H + 0.03) {
          s.x = NET_X + (px < NET_X ? -0.03 : 0.03);
          s.vx = -s.vx * 0.12; s.vy = Math.min(s.vy, 0) * 0.3;
          this.events.push({ k: 'net', x: NET_X, y: Math.max(0.2, yAt), p: Math.min(1, sp / 30) });
        }
      }

      if (s.y <= 0 && this.phase === 'rally') {
        s.y = 0; s.vx *= 0.2; s.vy = 0;
        this.events.push({ k: 'floor', x: s.x, p: Math.min(1, sp / 25) });
        const inBounds = s.x >= 0 && s.x <= COURT_W;
        const landSide = s.x < NET_X ? 0 : 1;
        const hitter = this.lastHitter < 0 ? this.server : this.lastHitter;
        this.awardPoint(inBounds && landSide !== hitter ? hitter : 1 - hitter, inBounds ? (landSide !== hitter ? 'in' : 'own') : 'out');
      } else if (s.y <= 0) { s.y = 0; s.vx = 0; s.vy = 0; }
    }

    awardPoint(idx, why) {
      this.score[idx]++;
      this.server = idx;
      this.phase = 'point'; this.phaseTime = 0;
      this.events.push({ k: 'point', w: idx, why, hits: this.rallyHits });
      const a = this.score[idx], b = this.score[1 - idx];
      if (a >= this.target && a - b >= WIN_BY) {
        this.winner = idx; this.phase = 'over';
        this.events.push({ k: 'over', w: idx });
      }
    }

    // Is the next point a game point for somebody? Used for the "game point" banner.
    gamePoint() {
      const [a, b] = this.score;
      if (this.phase === 'over') return -1;
      if (a >= this.target - 1 && a - b >= 1) return 0;
      if (b >= this.target - 1 && b - a >= 1) return 1;
      return -1;
    }

    drainEvents() { const e = this.events; this.events = []; return e; }

    snapshot() {
      const r = (v) => Math.round(v * 1000) / 1000;
      const s = this.shuttle;
      return {
        ph: this.phase, sc: this.score.slice(), sv: this.server, w: this.winner, gp: this.gamePoint(), lh: this.lastHitter,
        p: this.players.map((p) => [r(p.x), r(p.y), r(p.vx), r(p.vy), p.swing < 0 ? -1 : r(p.swing), p.shot]),
        sh: [r(s.x), r(s.y), r(s.vx), r(s.vy), r(s.ang)],
        sa: this.phase === 'serve' ? [this.serveAim[this.server], r(NET_X + this.players[this.server].face * AIM_DIST[this.serveAim[this.server]]), this.serveHeight(this.server)] : null,
        ev: this.drainEvents(),
      };
    }
  }

  // Find the launch speed at which a shot fired at `angleDeg` from (x, y) comes down at `targetX` (range grows steadily
  // with speed, so bisect). Used so a serve or a drive lands in the opponent's court wherever it is hit from.
  function speedToLand(x, y, face, angleDeg, targetX, lo, hi) {
    const a = angleDeg * Math.PI / 180;
    const want = Math.abs(targetX - x);
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      let px = 0, py = y, vx = mid * Math.cos(a), vy = mid * Math.sin(a);
      for (let k = 0; k < 600 && py > 0; k++) {
        const sp = Math.hypot(vx, vy), dt = 1 / 60;
        vx += -DRAG * sp * vx * dt; vy += (-GRAVITY - DRAG * sp * vy) * dt;
        px += vx * dt; py += vy * dt;
      }
      if (px < want) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // height of a shot above the net tape when it passes, or -1 if it comes down before reaching the net
  function heightAtNet(x, y, face, angleDeg, speed) {
    const a = angleDeg * Math.PI / 180;
    let px = x, py = y, vx = face * speed * Math.cos(a), vy = speed * Math.sin(a);
    const dt = 1 / 60;
    for (let k = 0; k < 600 && py > 0; k++) {
      const sp = Math.hypot(vx, vy);
      vx += -DRAG * sp * vx * dt; vy += (-GRAVITY - DRAG * sp * vy) * dt;
      const nx = px + vx * dt, ny = py + vy * dt;
      if ((px - NET_X) * (nx - NET_X) < 0) return py + (ny - py) * ((NET_X - px) / (nx - px));
      px = nx; py = ny;
    }
    return -1;
  }

  // The serve for a chosen landing spot and height: the flattest launch angle of that style that still clears the net
  // comfortably, with the speed that makes it come down on the spot.
  function serveShot(x, y, face, targetX, heightIdx) {
    let best = null;
    for (const angle of SERVE_ANGLES[heightIdx]) {
      const speed = speedToLand(x, y, face, angle, targetX, 4, 56);
      const clear = heightAtNet(x, y, face, angle, speed);
      best = { speed, angle };
      if (clear >= NET_H + 0.3) break;
    }
    return best;
  }

  // The path a serve would take, as points, for the preview arc.
  function serveTrajectory(x, y, face, targetX, heightIdx) {
    const { speed, angle } = serveShot(x, y, face, targetX, heightIdx);
    const a = angle * Math.PI / 180;
    let px = x, py = y, vx = face * speed * Math.cos(a), vy = speed * Math.sin(a);
    const pts = [{ x: px, y: py }];
    const dt = 1 / 60;
    for (let k = 0; k < 600 && py > 0; k++) {
      const sp = Math.hypot(vx, vy);
      vx += -DRAG * sp * vx * dt; vy += (-GRAVITY - DRAG * sp * vy) * dt;
      px += vx * dt; py += vy * dt;
      if (k % 3 === 0) pts.push({ x: px, y: Math.max(0, py) });
    }
    return pts;
  }

  function blankInput() { return { left: false, right: false, jump: false, smash: false, drop: false, normal: false, far: false, near: false, hit: false, hitQueued: false, farQ: false, nearQ: false }; }

  // Where will the shuttle be when it comes down to height `atY`? Returns { x, t } or null if it never gets there.
  function predict(sh, atY) {
    let x = sh.x, y = sh.y, vx = sh.vx, vy = sh.vy, t = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      const sp = Math.hypot(vx, vy);
      vx += -DRAG * sp * vx * dt;
      vy += (-GRAVITY - DRAG * sp * vy) * dt;
      x += vx * dt; y += vy * dt; t += dt;
      if (vy < 0 && y <= atY) return { x, t };
      if (y <= 0) return { x, t };
    }
    return null;
  }

  return { Game, predict, blankInput, serveShot, serveTrajectory, AIM_DIST, SHOTS, COURT_W, NET_X, NET_H, SERVICE_LINE, DT, REACH, SWING_TIME, HIT_FROM, HIT_TO, WIN_SCORE, WIN_BY, POINT_PAUSE };
}));
