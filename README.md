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
hits the net, lands on the hitter's own side or lands out scores for the opponent. A player may not hit the shuttle
twice in a row (the server cannot hit their own serve), and may step up to one metre behind the back line.

## Controls

| Key | Action |
| --- | --- |
| left / right arrows | move |
| up arrow (or `W`) | jump |
| `Space` | swing (also serves) |
| `S` + `Space` | smash (needs a shuttle above head height, jumping makes it harder to defend) |
| `D` + `Space` | drop shot |
| `A` + `Space` | normal return (clear, or a lift when the shuttle is low) |
| forward arrow + `Space` | flat drive |

Hold the shot key and press `Space` together; the key held in the first moments of the swing decides the shot. Until
the serve is struck the server has to stay behind the short service line (the lit-up green zone); the receiver may
move up to the net and play the serve at once.

## Connections and names

- **Reconnecting:** if a player's connection drops (refresh, network blip, closed tab) the game is paused for up to a
  minute and the other player and any spectators see a countdown. The player's page rejoins the same seat by itself
  (a token kept in `sessionStorage`), so refreshing mid-game just carries on. Pressing the leave button ends the game
  straight away. The wait is `RECONNECT_GRACE_MS` on the server (60 s by default).
- **First connection:** the browser keeps trying to reach the server for a minute (a server that is still waking up
  can take a few seconds) before it gives up, with a cancel button.
- **Name:** typed once, then remembered in this browser (`localStorage`, with a cookie as a backup) and shown as
  "Playing as ..." with a change link.

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

## Credits

- The stands use a photo of a seated crowd by Aksh yadav from [Unsplash](https://unsplash.com/photos/crowd-of-people-sitting-on-stadium-seats-bY4cqxp7vos)
  (Unsplash License, free to use), saved as `public/crowd.jpg` (1600 px wide) and tinted purple in `render.js`. The
  front row of fans in front of it is drawn in code.
