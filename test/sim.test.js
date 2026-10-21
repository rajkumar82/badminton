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
  g.setInput(0, { right: true, hit: true });
  run(g, 0.5);
  assert.strictEqual(g.phase, 'rally');
  g.setInput(0, { right: true });
  run(g, 0.8);
  assert.ok(g.players[0].x > Sim.NET_X - Sim.SERVICE_LINE + 0.4, `after serve at ${g.players[0].x}`);
});

test('the serve crosses the net and lands in the receivers court', () => {
  for (const x of [1.5, 3.5, Sim.NET_X - Sim.SERVICE_LINE]) {
    const g = new Sim.Game();
    g.players[0].x = x;
    g.setInput(0, { hit: true });
    run(g, 4);
    assert.strictEqual(g.score[0], 1, `serve from ${x} should land in: ${JSON.stringify(g.score)}`);
  }
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
  g.setInput(0, Object.assign({ hit: true }, keys));
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
  g.setInput(0, { hit: true });
  for (let i = 0; i < 3; i++) g.step();            // swing has started with no modifier
  g.setInput(0, { hit: true, smash: true });       // S arrives a few milliseconds later
  let hit = null;
  for (let i = 0; i < 0.4 / Sim.DT && !hit; i++) { g.step(); hit = g.drainEvents().find((e) => e.k === 'hit'); }
  assert.strictEqual(hit.t, 'smash');
});
