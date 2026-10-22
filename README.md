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
hits the net, lands on the hitter's own side or lands out scores for the opponent. A serve that lands short of the
short service line (between the net and that line) is a fault and also scores for the opponent. A player may not hit the shuttle
twice in a row (the server cannot hit their own serve), and may step up to one metre behind the back line.

## Controls

| Key | Action |
| --- | --- |
| left / right arrows | move |
| up arrow (or `W`) | jump |
| `Space` | hit (also serves). The game picks the shot: a low shuttle is lifted, one hit high above your feet (jump for it) is smashed, anything else is a clear |
| down arrow + `Space` | drop shot, just over the net |
| forward arrow + `Space` | flat drive |
| `S` / `D` / `A` + `Space` | optional: force a smash, a drop or a clear |

A smash shows a red spot on the floor where it will land. A shuttle coming steeply down at you gets extra reach and a
longer hit window, so a smash can be dug out if you get close.

**Serving:** before you serve, tap the up or down arrow to choose how far it lands (near, mid or far). Three spots light
up on the opponent's half of the floor, the chosen one glows, and a dotted arc previews the flight. Hold `S` with
`Space` for a flat fast serve or `D` with `Space` for a high lob (the arc and label update as you hold the key). The
server cannot jump or cross the service line until the serve is struck. The serve is approximate: it lands somewhere
around the ring, which is drawn as wide as the serve may stray. Far and flat serves are the loosest, so they can land
on the line or out of the court, and a short flat one can clip the net. The computer varies its serves, and misses
them, too.

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
  `public/js/audio.js` makes every sound with WebAudio (no audio files): a hit is a sharp click, the ring of the string
  bed, a short cork thump and a faint feather rustle (a smash adds a hard crack), plus swishes, shoe squeaks and
  footsteps (the simulation reports `step` and `squeak` events), the shuttle ticking on the floor, and a quiet hall murmur.
- Shot speeds and angles live in `SHOTS` at the top of `sim.js`. `node test/tune.js` prints where each lands.

## Run it

    npm install
    npm start          # http://localhost:8080
    npm test

Open the page in two browser windows to try online play on one machine. `GET /api/stats` shows how many games are
running.

## Connection quality (silent)

As soon as an online game connects, each browser times a quick burst of pings to the server and keeps checking every
two seconds. Nothing is shown. From that each player is adjusted on their own:

- **How far behind the game is drawn:** a steady connection draws the game about 34 ms behind the server, a bumpy one
  up to 110 ms, so motion stays smooth without adding more delay than needed.
- **Lag compensation:** the browser tells the server its round trip and display delay, and the server judges that
  player's hits against where the shuttle was when they pressed (at most 0.12 s back). A press that looked on time on a
  slow connection counts as on time.
- **Trying it:** open the game with `?lag=80` to add 80 ms each way to that browser's connection, as if the server were
  far away (testing aid only).

## Deploying

Live at https://badminton.nocod.dev (Cloud Run service `badminton` in project `nocode-512210`, `asia-south1`, routed by
the Cloudflare Worker in `nocode/worker`).

    gcloud run deploy badminton --source . --project=nocode-512210 --region=asia-south1 --allow-unauthenticated       --max-instances=1 --min-instances=0 --concurrency=1000 --timeout=3600 --memory=512Mi --cpu=1

- **One instance only.** Rooms live in the memory of one server process, so the service must run a single instance
  (`--max-instances=1`) or two players could land on different instances. When it scales to zero (no connections) there
  are no games to lose; a cold start takes a few seconds, which the browser's one-minute connection retry covers.
- **WebSockets** work on Cloud Run and through the Worker unchanged. `--timeout=3600` is the longest a connection
  can stay open; the browser reconnects and takes its seat back if one is cut.
- Run a deploy on its own: starting a second `gcloud run deploy` for a service that is still being created gives a
  "resource already exists" conflict.
