# VAYTES Competition Timer

VAYTES is a self-hosted event timer: a phone operates a protected Room, while laptop/large-screen browsers join as read-only Displays. Express and Socket.IO keep Room state and timer transitions on the server.

## What is implemented

- Password-protected Room creation/joining, six-character unambiguous codes, hashed passwords, random resumable sessions, owner-only Controller authorization, and multiple Displays.
- Socket.IO Room state snapshots, reconnect recovery, ordered revisions, acknowledgements, member counts, input checks, and server-side command authorization.
- Server-authoritative timers for Mosaic 1D & 2D (20m), Mosaic 3D (40m), Fun With Machine (15m), Fun With Programming (60m), Mechanic Engineering (60m), and Programming (120m). Up to two level timers can run concurrently; each can be started, paused, resumed, reset, finished, and removed independently. After the main timer finishes for Fun With Programming, Mechanic Engineering, or Programming, the Controller can trigger one additional five-minute period.
- Separate mobile-first Controller and presentation-only Display. The Display loops supplied full-screen videos in backdrop, timer, and selected-video modes. One timer uses the existing full-screen clock; two timers share the same background in a split layout with large circular clocks. Level names and descriptions remain visible during the final minute, completed timers show a completion notice and stay hidden until reset, and the Controller can remotely retry video playback on connected Displays.
- A persistent Display audio element with a visible tap-to-enable prompt, playback retry feedback, mute and volume synchronization, and track-load handling.
- Memory-only Room storage with a 24-hour default expiry. Room passwords use bcrypt hashes; session tokens are stored server-side as SHA-256 hashes.

## Requirements and local development

- Node.js 20+ and npm.
- No paid APIs or managed realtime services.

```powershell
Copy-Item .env.example .env
npm install
npm install --prefix backend
npm install --prefix frontend
npm run dev

$env:VITE_SOCKET_URL = "https://YOUR-API-DOMAIN"
npm run build --prefix frontend
Remove-Item Env:VITE_SOCKET_URL
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The backend health endpoint is `http://localhost:3001/api/health`.

Run checks:

```powershell
npm test
npm run build
```

The backend tests use Node's built-in test runner. The production frontend build is written to `frontend/dist`.

## Independent scoring desk

The **Scoring desk** entry on the home page is separate from Rooms and does not connect to or change the Controller, Display, or timer state. It supports Mosaic 1D, Mosaic 2D, Mosaic 3D, Fun With Machine, Fun With Programming, Mechanic Engineering, and Programming.

Panduan integrasi lengkap berbahasa Indonesia: [PANDUAN_INTEGRASI_SCORING.md](./PANDUAN_INTEGRASI_SCORING.md).

- Set up MySQL or MariaDB, then set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` in `.env`. Run `npm run migrate --prefix backend` to create/update the scoring tables; backend startup also applies pending migrations. The database must already exist, and its account needs permission to create tables and read/write the scoring schema.
- From the repository root, the migration can also be run with the shorter command `npm run migrate`.
- Provision individual assistant and judge accounts with the backend command below. Repeat it for each staff member. Passwords are bcrypt-hashed; do not put account passwords in source control.
- `npm run seed` creates the shared `juri` and `asisten` accounts with one-time random passwords, without numbered judge accounts. Existing accounts are not reset by rerunning the seed.
- Juri accounts can add participants, record or update scores, see the top three, and open the all-participant results summary. Asisten accounts can select participants and upload evidence, but the API does not expose scores or allow score changes to them.
- Best attempt is highest score, then shortest completion time. Winners sort by score, time, then birth date (younger first); if all three are identical, names sort alphabetically for a stable order. Mosaic 1D/2D/3D and Fun With Machine use one attempt; Fun With Programming and Mechanic Engineering use three; Programming uses two.
- Scoring login tokens work across devices and renew for one year whenever used. Signing out revokes only that device's session.
- Uploaded photos and videos live on persistent local disk (default: `backend/storage/scoring-media`) and are served only through authenticated API requests. The participant view loads file metadata only; a photo or video is fetched when someone opens that individual item. Large photos are resized and converted to WebP in the browser when supported. Videos are uploaded as-is and streamed from disk; each file is limited to 200 MB.
- Back up the MySQL database and media directory together. For multi-instance hosting, shared storage is required and each instance must use the same persistent media directory.

Create the two default role accounts once:

```powershell
npm run seed
```

The seed prints each newly-created account's password once; save these credentials. Passwords must contain at least 4 characters and no more than 72 UTF-8 bytes. If an account already exists, seed leaves it unchanged. To create another named account or reset a password, use `npm run scoring:user --prefix backend` with `SCORING_USERNAME`, `SCORING_ROLE`, and `SCORING_PASSWORD` set. The seeder and backend use the MySQL settings in `.env`. `MYSQL_URL`, if configured, overrides the separate `MYSQL_*` settings. `SCORING_MEDIA_DIR` can point to a persistent writable folder outside the application tree. Without a reachable MySQL database, the existing timer continues to run and the scoring desk reports as unavailable.

## Environment

| Variable | Purpose | Local default |
|---|---|---|
| `PORT` | Port provided to Express by Node/cPanel | `3001` |
| `FRONTEND_ORIGINS` | Comma-separated exact browser origins allowed by API and Socket.IO | `http://localhost:5173,http://127.0.0.1:5173` |
| `ROOM_TTL_HOURS` | Room lifetime from creation | `24` |
| `ROOM_PASSWORD_MIN_LENGTH` | Minimum new Room password length (4–72) | `4` |
| `VITE_SOCKET_URL` | Socket.IO server URL embedded at frontend build time | `http://localhost:3001` |
| `MYSQL_HOST` | MySQL/MariaDB server for scoring | `127.0.0.1` |
| `MYSQL_PORT` | MySQL/MariaDB port | `3306` |
| `MYSQL_USER` | MySQL account used by scoring | `competition_app` |
| `MYSQL_PASSWORD` | Password for the MySQL account | set in `.env` |
| `MYSQL_DATABASE` | Existing database/schema for scoring | `competition_timer` |
| `MYSQL_URL` | Optional full MySQL URL that overrides `MYSQL_*` settings | unset |
| `SCORING_MEDIA_DIR` | Persistent directory for scoring uploads | `backend/storage/scoring-media` |

Set `FRONTEND_ORIGINS` to the exact HTTPS frontend origin(s) in production, and set `VITE_SOCKET_URL` to the public HTTPS/WSS API origin **before building** the frontend. Do not put backend secrets in `VITE_*` variables.

## Video and audio assets

The backdrop video at `frontend/public/assets/video/backdrop.MP4` is played muted, inline, and on a loop. Timer screens show `frontend/public/assets/video/background.mp4` directly behind the timer. The Display attaches only the video for its current view and uses a metadata preload hint; it does not preload every event clip. The browser fetches the active video as it plays. Audio is not preloaded and is assigned a source only after the user enables it. These settings preserve the original media quality; they reduce unnecessary eager loading, not the size of an individual video. If a video cannot load, the Display offers a local retry; the Controller's **Display videos** section also has a remote retry control for connected Displays. The Controller can play `break.mp4`, `closing.mp4`, and the supplied grading/scoring clips for Mosaic & FWM, FWP, Mechanic, and Programming. Video playback is muted and loops until another display view is selected.

`frontend/public/assets/audio/track-01.mp3` is supplied and used by the Display. The browser requires a user gesture to allow audible playback; tap the visible prompt on the Display when entering the Room. The Controller's audio panel controls mute/volume. The Display itself has no navigation or footer; press `F` to toggle fullscreen.

Only use music you have the right to play at the event. Different connected Display devices may each play audio if audio is activated on each one; for a single sound system, activate audio on only the Display connected to it.

## Deployment to cPanel Setup Node.js App

1. Confirm with the hosting provider that the plan supports a persistent Node.js application, incoming WebSocket upgrade requests, and/or Socket.IO HTTP long-polling; this cannot be verified without access to the actual cPanel account and provider configuration.
2. Build the frontend with the production `VITE_SOCKET_URL` and `FRONTEND_ORIGINS` settings. Upload `frontend/dist` to the document root of the HTTPS website (or serve it from a static subdomain).
3. Create a Setup Node.js App with a supported Node version (20+), application root set to the uploaded `backend` directory, and startup file `src/server.js`. Install backend dependencies in cPanel's application environment.
4. Configure `FRONTEND_ORIGINS`, `ROOM_TTL_HOURS`, and `ROOM_PASSWORD_MIN_LENGTH` in cPanel. The hosting platform supplies `PORT`; the server reads it and binds to `0.0.0.0`.
5. Enable HTTPS for the frontend and API host. Configure the provider's reverse proxy so `/socket.io/` preserves HTTP upgrade headers for WebSocket; allow long-lived requests for the polling transport as well. If the provider runs multiple application workers, use sticky sessions for polling or configure a single worker.
6. Open `/api/health`, then test a Controller on a mobile data connection and a Display on another network. Test upgrade to WebSocket, polling fallback, reconnect, and a Room timer across an application restart before using it at an event.
7. After each `git pull`, deploy both parts from the same revision: rebuild and upload `frontend/dist`, then restart the Node.js application in cPanel. Hard-refresh or reopen the Controller page so it loads the new frontend bundle. The level IDs in `frontend/src/App.jsx` must match `LEVELS` in `backend/src/timer.js`; `Unknown competition level` means the running frontend and backend likely came from different revisions.

Socket.IO is configured with both WebSocket and polling transports, so it can fall back to polling if an upgrade is unavailable. This does not guarantee that a given cPanel provider allows sufficiently long-running connections; confirm and test that behavior with the provider. The app does not silently substitute a paid service.

### Storage and restart limitation

Room data, active timer state, and Room session hashes remain in process memory. A backend restart, deployment, or process crash loses every Room, including its running timer; reconnect sessions cannot restore a lost Room. The app intentionally reports the Room as unavailable instead of pretending it recovered. The MySQL database used by the independent scoring desk does not persist Room or timer state. For production events that require timer restart recovery, move the Room/session/state store to a persistent database and persist timer timestamps and revisions.

## Project layout

```text
backend/
  src/server.js       Express, Socket.IO events, expiration and finish checks
  src/scoring.js      Independent MySQL scoring API and authenticated media access
  src/provision-scoring-user.js   Staff-account provisioning command
  src/rooms.js        Room/session membership and authorization
  src/timer.js        Pure timer state machine and level configuration
  test/               Timer, Room-manager, and scoring-ranking tests
frontend/
  src/App.jsx         Landing, Room forms, Controller, Display, audio engine
  src/ScoringApp.jsx  Independent role-based scoring and evidence UI
  src/styles.css      Responsive controller and large-screen presentation
  public/assets/audio/  Supplied track and optional licensed playlist tracks
  public/assets/video/               Backdrop, timer background, and event clips
PRD_VAYTES_Competition_Timer.md
referensi-desain.jpg
```

## Known limitations / verification status

- The cPanel provider's WebSocket support, HTTPS proxy behavior, and persistent-process policy are **unverified**; they require the hosting account/provider.
- Actual cross-network/two-device behavior is **not verified in this environment**.
- The five playlist locations are integration placeholders until licensed MP3 assets are supplied.
- Room persistence across a Node.js process restart is **not implemented**; memory-only behavior and expiry are documented above.
- Frontend automated browser tests and browser-specific audio/fullscreen checks are not included. Backend unit tests and the Vite production build should be run before release.

## No paid service requirement

The application code requires no paid API, realtime provider, or managed backend. Hosting, domain, and any infrastructure costs remain subject to the existing provider plan.
