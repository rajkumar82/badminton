// Rooms: creating, joining, spectating, running in parallel, and leaving.
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { startServer, rooms } = require('../server.js');
const { COURT_W } = require('../public/js/sim.js');

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const w = waiters.find((x) => x.type === m.t);
    if (w) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(m); } else inbox.push(m);
  });
  ws.next = (type) => new Promise((resolve, reject) => {
    const hit = inbox.find((m) => m.t === type);
    if (hit) { inbox.splice(inbox.indexOf(hit), 1); return resolve(hit); }
    const timer = setTimeout(() => reject(new Error('timeout waiting for ' + type)), 3000);
    waiters.push({ type, resolve, timer });
  });
  ws.sendJson = (o) => ws.send(JSON.stringify(o));
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

test('two players and a spectator in one game, two games in parallel', async () => {
  const srv = await startServer(0);
  try {
    const a = await client(srv.port), b = await client(srv.port), c = await client(srv.port);
    a.sendJson({ t: 'create', name: 'Asha' });
    const ja = await a.next('joined');
    assert.strictEqual(ja.role, 'player'); assert.strictEqual(ja.seat, 0);
    const code = ja.room.code;

    // the second person to open the link plays, and the game starts
    b.sendJson({ t: 'join', code: code.toLowerCase(), name: 'Bo' });
    const jb = await b.next('joined');
    assert.strictEqual(jb.role, 'player'); assert.strictEqual(jb.seat, 1);
    const start = await a.next('start');
    assert.deepStrictEqual(start.room.names, ['Asha', 'Bo']);

    // everyone after that watches
    c.sendJson({ t: 'join', code });
    const jc = await c.next('joined');
    assert.strictEqual(jc.role, 'spectator');
    const snap = await c.next('snap');
    assert.strictEqual(snap.s.ph, 'serve');

    // spectator input is ignored, a player's input moves their player
    c.sendJson({ t: 'input', right: true });
    a.sendJson({ t: 'input', right: true });
    await new Promise((r) => setTimeout(r, 400));
    const g = rooms.get(code).game;
    assert.ok(g.players[0].x > 2.2 + 0.3, 'player 0 moved');
    assert.strictEqual(g.players[1].x, COURT_W - 2.2);

    // a second, separate game runs at the same time
    const d = await client(srv.port), e = await client(srv.port);
    d.sendJson({ t: 'create' });
    const jd = await d.next('joined');
    e.sendJson({ t: 'join', code: jd.room.code });
    await e.next('joined');
    assert.strictEqual(rooms.size, 2);
    assert.notStrictEqual(jd.room.code, code);

    // a player leaving ends their game only
    a.close();
    const ended = await b.next('ended');
    assert.strictEqual(ended.why, 'left');
    await c.next('ended');
    assert.strictEqual(rooms.size, 1);
    [b, c, d, e].forEach((w) => w.close());
  } finally { srv.close(); }
});

test('unknown game code gives an error', async () => {
  const srv = await startServer(0);
  try {
    const a = await client(srv.port);
    a.sendJson({ t: 'join', code: 'ZZZZZ' });
    const err = await a.next('error');
    assert.strictEqual(err.code, 'nogame');
    a.close();
  } finally { srv.close(); }
});
