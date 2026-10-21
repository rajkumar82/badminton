# Badminton

A two-player badminton game for the browser (desktop keyboard), with a side-view court, a shuttlecock that flies with
real drag, and synthesised sounds. Play a friend online or play the computer.

- **Online:** one player starts a game and shares its link (`/?g=CODE`). The second person to open it plays, and the
  game starts straight away. Anyone who opens the link after that watches as a spectator. Many games run in parallel
  on one server, each in its own room.
- **Vs computer:** three levels (easy, medium, hard), runs entirely in the browser.
- **Names:** asked for first, remembered on that device. There is no sign-in yet.

## Rules

Rally scoring: every rally is a point. The winner of a point serves next. First to 15 wins, but once it is 14-14 the
game goes on until someone leads by two. A shot that lands in the opponent's half scores for the hitter; one that
hits the net, lands on the hitter's own side or lands out scores for the opponent.

## Controls

| Key | Action |
| --- | --- |
| `A` `D` or arrows | move |
| `W` or up | jump |
| `Space` | swing (also serves) |
| hold `S` + `Space` | drop shot |
| hold forward + `Space` | flat drive |
| jump + `Space` on a high shuttle | smash |
| `Space` on a low shuttle | defensive lift |

## How it works

- `public/js/sim.js` is the whole game: player movement, the swing and hit zone, the shuttle (gravity plus quadratic
  drag, which gives the steep drop of a real shuttle, and a heading that flips round after a hit), the net, scoring
  and serving. It is shared: the server runs it for online games and the browser runs it against the computer.
- `server.js` (Express + `ws`) steps every room at a fixed 120 Hz and sends a snapshot to its players and spectators
  about 60 times a second. Clients send only their key state. The browser draws snapshots slightly in the past and
  interpolates between them. The server is authoritative, so spectators see exactly what the players see.
- `public/js/ai.js` is the computer player. It predicts where the shuttle will come down, runs there, jumps for
  high ones and chooses between clear, drop and smash.
- `public/js/render.js` draws the canvas (arena, players with swing animations, net, trail, sparks, shake).
  `public/js/audio.js` makes every sound with WebAudio (no audio files).
- Shot speeds and angles live in `SHOTS` at the top of `sim.js`. `node test/tune.js` prints where each lands.

## Run it

    npm install
    npm start          # http://localhost:8080
    npm test

Open the page in two browser windows to try online play on one machine. `GET /api/stats` shows how many games are
running.

## Deploying (not done yet)

Rooms live in the memory of one server process, so the Cloud Run service must run a single instance
(`--max-instances=1`) or two players could land on different instances. WebSockets work on Cloud Run; the nocod.dev
Worker has to pass the upgrade request through unchanged. See `shared/README.md` and the root `CLAUDE.md` for the
`summary` and home page steps to do after the first deploy.
