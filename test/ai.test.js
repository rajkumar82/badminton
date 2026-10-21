// A bot against a bot should produce full games with sane scores; also the scoring rules themselves.
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../public/js/sim.js');
const { Bot } = require('../public/js/ai.js');

function playBots(levelA, levelB, maxSeconds = 4000) {
  const g = new Sim.Game();
  const bots = [new Bot(0, levelA), new Bot(1, levelB)];
  let rallies = 0, hits = 0;
  while (g.phase !== 'over' && g.time < maxSeconds) {
    for (const b of bots) g.setInput(b.idx, b.update(g, Sim.DT));
    g.step();
    for (const e of g.drainEvents()) { if (e.k === 'point') rallies++; if (e.k === 'hit') hits++; }
  }
  return { g, rallies, hits };
}

test('bots finish a game and the winner follows the rules', () => {
  const { g, rallies, hits } = playBots(2, 0);
  assert.strictEqual(g.phase, 'over');
  const [a, b] = g.score;
  assert.ok(Math.max(a, b) >= 15);
  assert.ok(Math.abs(a - b) >= 2);
  assert.strictEqual(g.winner, a > b ? 0 : 1);
  console.log(`  hard vs easy: ${a}-${b}, ${rallies} rallies, ${(hits / rallies).toFixed(1)} hits per rally, ${g.time.toFixed(0)}s`);
});

test('hard bot beats easy bot most of the time', () => {
  let wins = 0;
  for (let i = 0; i < 6; i++) {
    const { g } = playBots(2, 0);
    if (g.winner === 0) wins++;
  }
  console.log(`  hard beat easy ${wins}/6`);
  assert.ok(wins >= 4);
});

test('win by two once both reach the target', () => {
  const g = new Sim.Game();
  g.score = [14, 14];
  g.awardPoint(0, 'in');
  assert.strictEqual(g.phase, 'point'); // 15-14 is not over
  g.awardPoint(1, 'in'); // 15-15
  g.awardPoint(0, 'in'); // 16-15
  assert.notStrictEqual(g.phase, 'over');
  g.awardPoint(0, 'in'); // 17-15
  assert.strictEqual(g.phase, 'over');
  assert.strictEqual(g.winner, 0);
});

test('first to 15 wins when the opponent is behind by two or more', () => {
  const g = new Sim.Game();
  g.score = [14, 12];
  g.awardPoint(0, 'in');
  assert.strictEqual(g.phase, 'over');
});

test('the winner of a rally serves next', () => {
  const g = new Sim.Game();
  g.awardPoint(1, 'in');
  assert.strictEqual(g.server, 1);
  g.phaseTime = 0;
  for (let i = 0; i < 200; i++) g.step();
  assert.strictEqual(g.phase, 'serve');
  assert.strictEqual(g.server, 1);
  g.awardPoint(1, 'in');
  assert.strictEqual(g.server, 1); // keeps serving after winning again
  g.awardPoint(0, 'in');
  assert.strictEqual(g.server, 0);
});
