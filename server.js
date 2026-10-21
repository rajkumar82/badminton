// Online badminton: one player starts a game and shares its link, the second person to open it plays,
// everybody after that spectates. Every game is a Room with its own Sim.Game, all stepped by one loop.
// A player whose connection drops has a minute to come back (same seat, via a token) before the game is ended.
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Sim = require('./public/js/sim.js');

const PORT = process.env.PORT || 8080;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 300;
const MAX_SPECTATORS = 50;
const TICK_MS = 1000 / 60;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const graceMs = () => Number(process.env.RECONNECT_GRACE_MS) || 60 * 1000;

const rooms = new Map();

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function cleanName(raw, fallback) {
  const n = String(raw || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14);
  return n || fallback;
}

function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

class Room {
  constructor(code) {
    this.code = code;
    this.game = new Sim.Game();
    this.players = [null, null];   // sockets
    this.tokens = [crypto.randomBytes(9).toString('hex'), crypto.randomBytes(9).toString('hex')];
    this.away = [false, false];    // seat is held for a player whose connection dropped
    this.timers = [null, null];
    this.names = ['Player 1', 'Player 2'];
    this.spectators = new Set();
    this.started = false;
    this.rematch = [false, false];
    this.lastWinner = 0;
    this.created = Date.now();
  }

  info() {
    return { code: this.code, names: this.names, started: this.started, spectators: this.spectators.size };
  }

  get paused() { return this.away[0] || this.away[1]; }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of [...this.players, ...this.spectators]) if (ws && ws.readyState === 1) ws.send(data);
  }

  start() {
    this.started = true;
    this.rematch = [false, false];
    this.game.reset(this.lastWinner);
    this.broadcast({ t: 'start', room: this.info() });
  }

  // The player left on purpose: the game is over for everybody.
  remove(ws) {
    const idx = this.players.indexOf(ws);
    if (idx >= 0) {
      this.players[idx] = null;
      this.broadcast({ t: 'ended', why: 'left', who: this.names[idx] });
      this.close();
    } else if (this.spectators.delete(ws)) {
      ws.room = null;
      this.broadcast({ t: 'room', room: this.info() });
    }
  }

  // The connection dropped (refresh, network blip, closed tab): hold the seat for a minute.
  drop(ws) {
    const idx = this.players.indexOf(ws);
    if (idx < 0) { this.remove(ws); return; }
    this.players[idx] = null;
    this.away[idx] = true;
    this.game.setInput(idx, Sim.blankInput());
    const secs = Math.round(graceMs() / 1000);
    this.broadcast({ t: 'paused', who: this.names[idx], secs });
    clearTimeout(this.timers[idx]);
    this.timers[idx] = setTimeout(() => {
      if (!this.away[idx]) return;
      this.broadcast({ t: 'ended', why: 'left', who: this.names[idx] });
      this.close();
    }, graceMs());
  }

  rejoin(ws, seat) {
    clearTimeout(this.timers[seat]);
    this.away[seat] = false;
    this.players[seat] = ws; ws.room = this; ws.seat = seat;
    send(ws, { t: 'joined', role: 'player', seat, token: this.tokens[seat], room: this.info(), resumed: true });
    if (!this.paused) this.broadcast({ t: 'resumed', who: this.names[seat] });
  }

  close() {
    for (const t of this.timers) clearTimeout(t);
    for (const ws of [...this.players, ...this.spectators]) if (ws) ws.room = null;
    this.players = [null, null];
    this.spectators.clear();
    rooms.delete(this.code);
  }
}

function handle(ws, msg) {
  switch (msg.t) {
    case 'create': {
      if (ws.room) return;
      if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', msg: 'The server is full right now, please try again in a minute.' });
      const code = newCode();
      if (!code) return send(ws, { t: 'error', msg: 'Could not create a game, please try again.' });
      const room = new Room(code);
      rooms.set(code, room);
      console.log(`game ${code} created (${rooms.size} running)`);
      room.players[0] = ws; room.names[0] = cleanName(msg.name, 'Player 1');
      ws.room = room; ws.seat = 0;
      send(ws, { t: 'joined', role: 'player', seat: 0, token: room.tokens[0], room: room.info() });
      break;
    }
    case 'join': {
      if (ws.room) return;
      const room = rooms.get(String(msg.code || '').toUpperCase());
      if (!room) return send(ws, { t: 'error', code: 'nogame', msg: 'That game was not found. It may have ended.' });
      if (!room.players[1] && !room.away[1] && !room.started) {
        room.players[1] = ws; room.names[1] = cleanName(msg.name, 'Player 2');
        ws.room = room; ws.seat = 1;
        send(ws, { t: 'joined', role: 'player', seat: 1, token: room.tokens[1], room: room.info() });
        room.start();
      } else {
        if (room.spectators.size >= MAX_SPECTATORS) return send(ws, { t: 'error', msg: 'This game has too many spectators.' });
        room.spectators.add(ws);
        ws.room = room; ws.seat = -1;
        send(ws, { t: 'joined', role: 'spectator', seat: -1, room: room.info() });
        room.broadcast({ t: 'room', room: room.info() });
      }
      break;
    }
    case 'rejoin': {
      if (ws.room) return;
      const room = rooms.get(String(msg.code || '').toUpperCase());
      const seat = room ? room.tokens.findIndex((t) => t === msg.token) : -1;
      if (!room || seat < 0) return send(ws, { t: 'error', code: 'norejoin', msg: 'That game is no longer running.' });
      // an old connection of the same player may not have been noticed as closed yet
      const old = room.players[seat];
      if (old && old !== ws) { room.players[seat] = null; old.room = null; old.close(); }
      room.rejoin(ws, seat);
      break;
    }
    case 'input': {
      const room = ws.room;
      if (!room || ws.seat < 0 || !room.started) return;
      room.game.setInput(ws.seat, msg);
      break;
    }
    case 'rematch': {
      const room = ws.room;
      if (!room || ws.seat < 0 || room.game.phase !== 'over') return;
      room.rematch[ws.seat] = true;
      room.broadcast({ t: 'rematch', who: ws.seat });
      if (room.rematch[0] && room.rematch[1]) { room.lastWinner = room.game.winner < 0 ? 0 : room.game.winner; room.start(); }
      break;
    }
    case 'leave': {
      if (ws.room) ws.room.remove(ws);
      break;
    }
    default:
  }
}

function startServer(port = PORT) {
  const app = express();
  app.get('/api/stats', (req, res) => {
    let players = 0, spectators = 0;
    for (const r of rooms.values()) { players += r.players.filter(Boolean).length; spectators += r.spectators.size; }
    res.json({ games: rooms.size, players, spectators });
  });
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(res, file) {
      // pages and code are re-checked on every visit so a new deploy shows up; the service worker must never be stuck on an old copy
      const ext = path.extname(file);
      if (ext === '.html' || ext === '.js' || path.basename(file) === 'sw.js') res.set('Cache-Control', 'no-cache');
    },
  }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

  wss.on('connection', (ws) => {
    ws.alive = true; ws.room = null; ws.seat = -1;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      if (msg && typeof msg === 'object') handle(ws, msg);
    });
    ws.on('close', () => { if (ws.room) ws.room.drop(ws); });
    ws.on('error', () => {});
  });

  // one loop steps every game; physics run at a fixed rate whatever the timer jitter
  let last = process.hrtime.bigint();
  let acc = 0;
  const loop = setInterval(() => {
    const now = process.hrtime.bigint();
    acc += Number(now - last) / 1e9; last = now;
    if (acc > 0.25) acc = 0.25;
    const steps = Math.floor(acc / Sim.DT);
    acc -= steps * Sim.DT;
    for (const room of rooms.values()) {
      if (!room.started || room.paused) continue;
      for (let i = 0; i < steps; i++) room.game.step();
      room.broadcast({ t: 'snap', s: room.game.snapshot() });
    }
  }, TICK_MS);

  // drop sockets that stopped answering and rooms that were never joined
  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
    for (const room of rooms.values()) {
      if (!room.started && Date.now() - room.created > 60 * 60 * 1000) {
        for (const ws of room.players) if (ws) send(ws, { t: 'ended', why: 'timeout' });
        room.close();
      }
    }
  }, 30000);

  return new Promise((resolve) => server.listen(port, () => {
    console.log(`badminton listening on ${server.address().port}`);
    resolve({
      server, wss, port: server.address().port,
      close() {
        clearInterval(loop); clearInterval(sweep);
        for (const r of [...rooms.values()]) r.close();
        for (const ws of wss.clients) ws.terminate();
        wss.close(); server.close();
      },
    });
  }));
}

if (require.main === module) startServer();

module.exports = { startServer, rooms };
