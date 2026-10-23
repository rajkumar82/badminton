// Computer opponent. Looks at the game like a player would: works out where the shuttle will come down, runs
// there, jumps for high ones and swings when it is in reach. `level` 0 easy, 1 medium, 2 hard.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'));
  else root.AI = factory(root.Sim);
}(typeof self !== 'undefined' ? self : this, function (Sim) {
  const LEVELS = [
    { reaction: 0.5, error: 1.7, jumpy: 0.3, smart: 0.1, serveDelay: 1.8 },
    { reaction: 0.22, error: 0.7, jumpy: 0.7, smart: 0.45, serveDelay: 1.2 },
    { reaction: 0.06, error: 0.12, jumpy: 1, smart: 0.95, serveDelay: 0.8 },
  ];

  class Bot {
    constructor(idx, level = 1) {
      this.idx = idx;
      this.cfg = LEVELS[Math.max(0, Math.min(2, level))];
      this.targetX = null;
      this.think = 0;
      this.holdHit = 0;
      this.wantJump = false;
      this.down = false;
      this.smash = false;
      this.serveAt = 0;
      this.lastHit = false;
      this.lastFar = false; this.lastNear = false;
      this.serveH = 1;
      this.wantAim = 1;
    }

    // Returns the input for this moment. Called every physics step.
    update(game, dt) {
      const input = this.decide(game, dt);
      // a swing needs a fresh press, so pulse the key rather than holding it down
      if (input.hit && this.lastHit) input.hit = false;
      this.lastHit = input.hit;
      if (input.far && this.lastFar) input.far = false;
      this.lastFar = input.far;
      if (input.near && this.lastNear) input.near = false;
      this.lastNear = input.near;
      return input;
    }

    decide(game, dt) {
      const me = game.players[this.idx];
      const foe = game.players[1 - this.idx];
      const s = game.shuttle;
      const cfg = this.cfg;
      const input = Sim.blankInput();
      input.bot = true;
      const onMySide = this.idx === 0 ? s.x < Sim.NET_X : s.x > Sim.NET_X;
      const home = this.idx === 0 ? Sim.NET_X - 3.3 : Sim.NET_X + 3.3;

      if (game.phase === 'serve') {
        if (game.server === this.idx) {
          if (this.serveAt === 0) {
            this.serveAt = game.time + cfg.serveDelay;
            // a different serve each time: how far it lands and how high it goes
            this.wantAim = Math.random() < 0.4 ? 1 : Math.random() < 0.5 ? 0 : 2;
            const r = Math.random();
            this.serveH = r < 0.25 ? 0 : r < 0.5 ? 2 : 1;
          }
          const cur = game.serveAim[this.idx];
          if (cur < this.wantAim) input.far = true; else if (cur > this.wantAim) input.near = true;
          if (this.serveH === 0) input.smash = true; else if (this.serveH === 2) input.drop = true;
          if (game.time >= this.serveAt && cur === this.wantAim) input.hit = true;
        } else this.serveAt = 0;
        this.goTo(me, home, input);
        return input;
      }
      this.serveAt = 0;
      if (game.phase !== 'rally') { this.goTo(me, home, input); return input; }

      this.think -= dt;
      const incoming = onMySide || (this.idx === 0 ? s.vx < 0 : s.vx > 0);
      const canHit = game.lastHitter !== this.idx;
      if (this.think <= 0 && incoming && canHit) {
        this.think = cfg.reaction;
        const hitY = me.y + 1.6;
        const pred = Sim.predict(s, Math.max(hitY, 1.4));
        if (pred) {
          // the bot hits on the way down, a little in front of itself
          this.targetX = pred.x - me.face * 0.45 + (Math.random() - 0.5) * 2 * cfg.error;
          this.landT = pred.t;
          this.high = s.y > 2.3 || pred.t < 0.5 && s.y > 2.0;
          this.wantJump = this.high && Math.random() < cfg.jumpy;
        }
        // placement: hard bots drop when the opponent is deep and clear when they are at the net
        const foeDeep = Math.abs(foe.x - Sim.NET_X) > 3.8;
        this.down = Math.random() < cfg.smart ? foeDeep : Math.random() < 0.15;
        this.smash = Math.random() < 0.25 + 0.7 * cfg.smart;
      }
      if (!incoming || !canHit) { this.targetX = null; this.wantJump = false; this.down = false; this.smash = false; }

      const tx = this.targetX === null ? home : this.targetX;
      this.goTo(me, tx, input);

      if (this.targetX !== null && canHit) {
        const c = { x: me.x + me.face * 0.45, y: me.y + 1.6 };
        const dist = Math.hypot(s.x - c.x, s.y - c.y);
        // jump so that the racket reaches a high shuttle just as it arrives
        if (this.wantJump && me.y === 0 && Math.abs(me.x - tx) < 0.8 && s.y > 2.6 && Math.hypot(s.x - c.x, s.y - c.y) < 2.6) input.jump = true;
        const high = s.y > me.y + 1.9;
        input.smash = this.smash && high;
        input.drop = !input.smash && this.down;
        input.normal = !input.smash && !input.drop; // never a drive just because it is running forward
        const closing = dist < Sim.REACH * 1.15 + 0.35;
        if (closing && me.swing < 0) input.hit = true;
      }
      return input;
    }

    goTo(me, x, input) {
      const d = x - me.x;
      if (d > 0.12) input.right = true;
      else if (d < -0.12) input.left = true;
    }
  }

  return { Bot, LEVELS };
}));
