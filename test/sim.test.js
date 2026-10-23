// Serving rules: the server stays behind the service line until the serve is struck, the receiver is free to move up.
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../public/js/sim.js');

function run(g, seconds) { for (let i = 0; i < seconds / Sim.DT; i++) g.step(); }

test('server cannot cross the service line before serving', () => {
  const g = new Sim.Game();
  g.setInput(0, { right: true });
  run(g, 3);
  assert.ok(g.players[0].x <= Sim.NET_X - Sim.SERVICE_LINE + 1e-9, `server at ${g.players[0].x}`);
  assert.ok(g.players[0].x > Sim.NET_X - Sim.SERVICE_LINE - 0.05, 'server should reach the line');
});

test('receiver can move right up to the net while the serve is pending', () => {
  const g = new Sim.Game();
  g.setInput(1, { left: true });
  run(g, 3);
  assert.ok(g.players[1].x < Sim.NET_X + 1, `receiver at ${g.players[1].x}`);
});

test('after the serve is struck both players are free', () => {
  const g = new Sim.Game();
  g.setInput(0, { bot: true, right: true, hit: true });
  run(g, 0.5);
  assert.strictEqual(g.phase, 'rally');
  g.setInput(0, { right: true });
  run(g, 0.8);
  assert.ok(g.players[0].x > Sim.NET_X - Sim.SERVICE_LINE + 0.4, `after serve at ${g.players[0].x}`);
});

test('the serve crosses the net and lands in the receivers court', () => {
  for (const x of [1.5, 3.5, Sim.NET_X - Sim.SERVICE_LINE]) {
    const g = new Sim.Game({ rng: () => 0.5 });
    g.players[0].x = x;
    g.setInput(0, { bot: true, hit: true });
    run(g, 4);
    assert.strictEqual(g.score[0], 1, `serve from ${x} should land in: ${JSON.stringify(g.score)}`);
  }
});

test('a serve that lands short of the short service line is a fault', () => {
  const g = new Sim.Game({ rng: () => 0.5 });
  g.shuttle.x = g.players[0].x; g.shuttle.y = 1; g.shuttle.vx = 0; g.shuttle.vy = 0;
  g.phase = 'rally'; g.lastHitter = 0; g.rallyHits = 1;
  g.shuttle.x = Sim.NET_X + 1.0;           // lands 1 m past the net, inside the short service line
  g.shuttle.y = 0.01; g.shuttle.vy = -5;
  g.step();
  assert.deepStrictEqual(g.score, [0, 1]);
});

test('the second server uses the other side of the net', () => {
  const g = new Sim.Game();
  g.reset(1);
  g.setInput(1, { left: true });
  run(g, 3);
  assert.ok(g.players[1].x >= Sim.NET_X + Sim.SERVICE_LINE - 1e-9);
});

// the key held with Space chooses the shot
function shotWith(keys, shuttleY, face = 1) {
  const g = new Sim.Game();
  g.phase = 'rally'; g.lastHitter = 1;
  const p = g.players[0];
  p.x = 4; p.y = 0;
  Object.assign(g.shuttle, { x: p.x + 0.45, y: shuttleY, vx: -3, vy: -2, speed: 4 });
  g.setInput(0, Object.assign({ bot: true, hit: true }, keys));
  let hit = null;
  for (let i = 0; i < 0.4 / Sim.DT && !hit; i++) { g.step(); hit = g.drainEvents().find((e) => e.k === 'hit'); }
  return hit && hit.t;
}

test('S + Space smashes, D + Space drops, A + Space returns normally', () => {
  assert.strictEqual(shotWith({ smash: true }, 2.4), 'smash');
  assert.strictEqual(shotWith({ drop: true }, 2.0), 'drop');
  assert.strictEqual(shotWith({ normal: true }, 2.0), 'clear');
  assert.strictEqual(shotWith({}, 2.0), 'clear');
  assert.strictEqual(shotWith({ right: true }, 2.0), 'drive');
});

test('a low shuttle is lifted, and a smash needs a shuttle above the hand', () => {
  assert.strictEqual(shotWith({ normal: true }, 0.7), 'lift');
  assert.strictEqual(shotWith({ smash: true }, 1.35), 'clear');
});

test('a shot key pressed just after Space still counts', () => {
  const g = new Sim.Game();
  g.phase = 'rally'; g.lastHitter = 1;
  g.players[0].x = 4;
  Object.assign(g.shuttle, { x: 4.45, y: 2.4, vx: -3, vy: -2, speed: 4 });
  g.setInput(0, { bot: true, hit: true });
  for (let i = 0; i < 3; i++) g.step();            // swing has started with no modifier
  g.setInput(0, { bot: true, hit: true, smash: true });       // S arrives a few milliseconds later
  let hit = null;
  for (let i = 0; i < 0.4 / Sim.DT && !hit; i++) { g.step(); hit = g.drainEvents().find((e) => e.k === 'hit'); }
  assert.strictEqual(hit.t, 'smash');
});

test('the server cannot hit their own serve again', () => {
  const g = new Sim.Game();
  g.setInput(0, { bot: true, hit: true });
  run(g, 0.2);
  assert.strictEqual(g.phase, 'rally');
  assert.strictEqual(g.lastHitter, 0);
  // swing again while the shuttle is still beside the racket: nothing should happen
  g.setInput(0, { hit: false }); run(g, 0.05);
  g.shuttle.x = g.players[0].x + 0.5; g.shuttle.y = g.players[0].y + 1.5;
  g.drainEvents();
  g.setInput(0, { bot: true, hit: true, smash: true });
  const hits = [];
  for (let i = 0; i < 0.4 / Sim.DT; i++) { g.step(); hits.push(...g.drainEvents().filter((e) => e.k === 'hit')); }
  assert.strictEqual(hits.length, 0);
});

test('players can step behind the back lines, but not forever', () => {
  const g = new Sim.Game();
  g.setInput(0, { left: true }); g.setInput(1, { right: true });
  run(g, 3);
  assert.ok(g.players[0].x < -0.3 && g.players[0].x >= -1.0 - 1e-9, `left player at ${g.players[0].x}`);
  assert.ok(g.players[1].x > Sim.COURT_W + 0.3 && g.players[1].x <= Sim.COURT_W + 1.0 + 1e-9, `right player at ${g.players[1].x}`);
});

test('a drive lands in the opponents court from anywhere in the front half', () => {
  for (const x of [2, 3.5, 5, 6]) {
    const g = new Sim.Game();
    g.phase = 'rally'; g.lastHitter = 1; g.players[0].x = x;
    Object.assign(g.shuttle, { x: x + 0.45, y: 1.9, vx: -3, vy: -2, speed: 4 });
    g.setInput(0, { bot: true, hit: true, right: true });
    run(g, 5);
    assert.ok(g.score[0] === 1 || g.score[1] === 0 && g.phase === 'rally', `drive from ${x}: ${JSON.stringify(g.score)}`);
  }
});

// ---- serve aiming ----
test('up and down taps move the serve target between near, mid and far', () => {
  const g = new Sim.Game();
  assert.strictEqual(g.serveAim[0], 1);
  g.setInput(0, { bot: true, far: true }); run(g, 0.02); g.setInput(0, { bot: true, far: false }); run(g, 0.02);
  assert.strictEqual(g.serveAim[0], 2);
  g.setInput(0, { bot: true, far: true }); run(g, 0.02); g.setInput(0, { bot: true, far: false }); run(g, 0.02);
  assert.strictEqual(g.serveAim[0], 2, 'cannot go beyond far');
  for (let i = 0; i < 3; i++) { g.setInput(0, { bot: true, near: true }); run(g, 0.02); g.setInput(0, { bot: true, near: false }); run(g, 0.02); }
  assert.strictEqual(g.serveAim[0], 0);
});

test('a very short tap of the arrow key still counts', () => {
  const g = new Sim.Game();
  g.setInput(0, { bot: true, far: true }); g.setInput(0, { bot: true, far: false });   // pressed and released before a physics step
  run(g, 0.02);
  assert.strictEqual(g.serveAim[0], 2);
});

test('the serve lands where it was aimed, for every length and height', () => {
  for (const aim of [0, 1, 2]) for (const key of [{}, { smash: true }, { drop: true }]) {
    const g = new Sim.Game({ rng: () => 0.5 });
    g.players[0].x = 3.0; g.serveAim[0] = aim;
    g.setInput(0, Object.assign({ bot: true, hit: true }, key));
    let landed = null;
    for (let i = 0; i < 6 / Sim.DT && landed === null; i++) {
      g.step();
      if (g.drainEvents().some((e) => e.k === 'floor')) landed = g.shuttle.x;
    }
    const want = Sim.NET_X + Sim.AIM_DIST[aim];
    assert.ok(landed !== null && Math.abs(landed - want) < 0.7, `aim ${aim} ${JSON.stringify(key)}: landed ${landed}, wanted ${want}`);
  }
});

test('S gives a flat fast serve and D a high lob', () => {
  const apex = (key) => {
    const g = new Sim.Game({ rng: () => 0.5 });
    g.players[0].x = 3.0;
    g.setInput(0, Object.assign({ bot: true, hit: true }, key));
    let top = 0;
    for (let i = 0; i < 3 / Sim.DT; i++) { g.step(); top = Math.max(top, g.shuttle.y); g.drainEvents(); }
    return top;
  };
  const flat = apex({ smash: true }), normal = apex({}), high = apex({ drop: true });
  assert.ok(flat < normal && normal < high, `apex flat ${flat}, normal ${normal}, high ${high}`);
  assert.ok(high > 5, 'a lob goes properly high');
});

test('the server cannot jump while the serve is pending', () => {
  const g = new Sim.Game();
  g.setInput(0, { jump: true });
  run(g, 0.3);
  assert.strictEqual(g.players[0].y, 0);
});

test('serves are approximate: they land around the target, sometimes short or out', () => {
  const landings = [];
  const stray = { net: 0, out: 0, inCourt: 0 };
  for (let n = 0; n < 150; n++) {
    const g = new Sim.Game();
    g.players[0].x = 3.0; g.serveAim[0] = 2;            // far: the loosest
    g.setInput(0, { bot: true, hit: true });
    for (let i = 0; i < 6 / Sim.DT && g.phase !== 'point'; i++) g.step();
    const x = g.shuttle.x;
    landings.push(x);
    if (x < Sim.NET_X) stray.net++; else if (x > Sim.COURT_W) stray.out++; else stray.inCourt++;
  }
  const mean = landings.reduce((a, b) => a + b, 0) / landings.length;
  const sd = Math.sqrt(landings.reduce((a, b) => a + (b - mean) ** 2, 0) / landings.length);
  assert.ok(Math.abs(mean - (Sim.NET_X + Sim.AIM_DIST[2])) < 0.8, `mean landing ${mean}`);
  assert.ok(sd > 0.6 && sd < 1.8, `spread ${sd}`);
  assert.ok(stray.inCourt > 90, 'most land in');
  assert.ok(stray.out > 0, 'some go out');
});

test('a short serve can clip the net', () => {
  let faults = 0;
  for (let n = 0; n < 300; n++) {
    const g = new Sim.Game();
    g.players[0].x = 4.5; g.serveAim[0] = 0;            // near, from right behind the line
    g.setInput(0, { bot: true, hit: true, smash: true });          // flat, so it has little room to spare
    for (let i = 0; i < 4 / Sim.DT && g.phase !== 'point'; i++) g.step();
    if (g.score[1] === 1) faults++;
  }
  assert.ok(faults > 0 && faults < 150, `faults ${faults}`);
});

// ---- one-button hitting ----
function rallyAt(shuttle, player = {}) {
  const g = new Sim.Game({ rng: () => 0.5 });
  g.phase = 'rally'; g.lastHitter = 1; g.rallyHits = 2;
  Object.assign(g.players[0], player);
  Object.assign(g.shuttle, { vx: 0, vy: 0, speed: 0 }, shuttle);
  return g;
}
function swingAndRead(g, keys = {}) {
  g.setInput(0, Object.assign({ bot: true, hit: true }, keys));
  g.step();
  g.setInput(0, Object.assign({ hit: false }, keys));
  let hit = null;
  for (let i = 0; i < 0.4 / Sim.DT && !hit; i++) { g.step(); hit = (g.snapshot().ev || []).find((e) => e.k === 'hit') || hit; }
  return hit;
}

test('Space alone picks the shot: lift when low, clear at normal height, smash when high', () => {
  const lo = swingAndRead(rallyAt({ x: 3.0, y: 0.5 }, { x: 2.7 }));
  assert.strictEqual(lo && lo.t, 'lift');
  const mid = swingAndRead(rallyAt({ x: 3.0, y: 1.8 }, { x: 2.7 }));
  assert.strictEqual(mid && mid.t, 'clear');
  const hi = swingAndRead(rallyAt({ x: 3.0, y: 3.1 }, { x: 2.7, y: 1.0 }));   // in the air, above the head
  assert.strictEqual(hi && hi.t, 'smash');
});

test('holding down with Space drops the shuttle', () => {
  const h = swingAndRead(rallyAt({ x: 3.0, y: 1.8 }, { x: 2.7 }), { bot: true, near: true });
  assert.strictEqual(h && h.t, 'drop');
});

test('a smash coming down fast can be dug out from further away than a normal shuttle', () => {
  // 1.5 m from the racket centre: beyond the normal 1.2 m reach, inside the extended one
  const at = (extra) => { const g = rallyAt(Object.assign({ x: 4.95, y: 0.9 }, extra), { x: 3.0 }); g.players[0].swing = 0.1; g.tryHit(g.players[0]); return g.lastHitter === 0; };
  assert.strictEqual(at({ vx: -4, vy: -9, speed: 9.8 }), true, 'fast and steep: defended');
  assert.strictEqual(at({ vx: -1, vy: -2, speed: 2.2 }), false, 'slow: out of reach');
});

test('a low shuttle can be picked up in a lunge: the racket reaches down towards the floor', () => {
  const g = rallyAt({ x: 3.5, y: 0.35 }, { x: 3.0 });
  g.players[0].swing = 0.1; g.tryHit(g.players[0]);
  assert.strictEqual(g.lastHitter, 0);
});

test('lag compensation: a hit is judged against where the shuttle was a moment ago', () => {
  const build = (lag) => {
    const g = rallyAt({ x: 3.5, y: 1.6, vx: 8, vy: 0, speed: 8 }, { x: 3.0 });
    g.lag[0] = lag;
    // the shuttle has been flying away from the racket: 0.1 s ago it was within reach, now it is out of it
    for (let i = 0; i < 20; i++) g.hist.push([3.45 + i * 0.07, 1.6]);   // oldest first, newest last
    g.shuttle.x = 3.45 + 19 * 0.07;                                      // 4.78: well out of the 1.2 m reach of a racket at 3.45
    g.players[0].swing = 0.1;
    g.tryHit(g.players[0]);
    return g.lastHitter === 0;
  };
  assert.strictEqual(build(0), false, 'without compensation the hit is out of reach');
  assert.strictEqual(build(0.12), true, 'with compensation it counts, because the player saw it in reach');
});

test('a person serves by holding hit and letting go: angle swings while held, strength follows up and down', () => {
  const g = new Sim.Game({ rng: () => 0.5 });
  const p0 = g.power[0];
  g.setInput(0, { jump: true }); run(g, 0.2);
  assert.ok(g.power[0] > p0, 'up raises the strength');
  g.setInput(0, { jump: false, hit: true }); run(g, 0.3);
  assert.strictEqual(g.phase, 'serve', 'nothing happens while hit is held');
  const [, deg, state] = g.snapshot().sa;
  assert.strictEqual(state, 1);
  assert.ok(deg > 20, 'the angle has moved');
  g.setInput(0, { hit: false }); run(g, 0.5);
  assert.notStrictEqual(g.phase, 'serve', 'letting go serves');
});
