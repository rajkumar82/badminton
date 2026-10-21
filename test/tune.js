// Prints where each shot lands from a typical contact point (for tuning SHOTS in public/js/sim.js).
const Sim = require('../public/js/sim.js');
function fly(type, fromX, fromY) {
  const g = new Sim.Game();
  const s = g.shuttle, p = g.players[0];
  p.x = fromX - 0.45; p.y = type === 'smash' ? 0.9 : 0;
  g.phase = 'rally'; g.lastHitter = -1;
  s.x = fromX; s.y = fromY; s.vx = 5; s.vy = -3; s.speed = 6;
  g.launch(p, type);
  let t = 0, apex = 0, clear = null;
  let px = s.x, py = s.y;
  while (s.y > 0 && t < 10) {
    g.stepShuttle(Sim.DT); t += Sim.DT; apex = Math.max(apex, s.y);
    if (clear === null && px < Sim.NET_X && s.x >= Sim.NET_X) clear = s.y;
    px = s.x;
  }
  console.log(type.padEnd(6), `from (${fromX},${fromY})`, `lands x=${s.x.toFixed(2)}`, `net y=${clear === null ? 'n/a' : clear.toFixed(2)}`, `apex=${apex.toFixed(2)}`, `t=${t.toFixed(2)}s`);
}
for (const [x, y] of [[3, 2.4], [5, 2.4], [2, 1.5], [5.5, 2.0]]) {
  for (const t of ['clear', 'drive', 'drop', 'lift']) fly(t, x, y);
  console.log('');
}
fly('smash', 4, 3.2); fly('smash', 5.5, 3.2); fly('serve', 2.6, 1.15); fly('serve', 4.5, 1.15);
