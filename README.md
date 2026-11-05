# VAYTES Competition Timer

VAYTES is a self-hosted event timer: a phone operates a protected Room, while laptop/large-screen browsers join as read-only Displays. Express and Socket.IO keep Room state and timer transitions on the server.

## What is implemented

- Password-protected Room creation/joining, six-character unambiguous codes, hashed passwords, random resumable sessions, owner-only Controller authorization, and multiple Displays.
- Socket.IO Room state snapshots, reconnect recovery, ordered revisions, acknowledgements, member counts, input checks, and server-side command authorization.
- Server-authoritative timer for Mosaic (20m), FWM (20m), FWP (60m), Mechanic Engineering (60m), and Programming (120m). Start, pause, resume, reset, finish, and guarded level switching are implemented.
- Separate mobile-first Controller and presentation-only Display. The Display loops the supplied full-screen video in backdrop mode; timer mode uses a white background with black digits and the competition title. It includes a fullscreen control and no timer controls.
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
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The backend health endpoint is `http://localhost:3001/api/health`.

Run checks:

```powershell
npm test
npm run build
```

The backend tests use Node's built-in test runner. The production frontend build is written to `frontend/dist`.

## Environment

| Variable | Purpose | Local default |
|---|---|---|
| `PORT` | Port provided to Express by Node/cPanel | `3001` |
| `FRONTEND_ORIGINS` | Comma-separated exact browser origins allowed by API and Socket.IO | `http://localhost:5173,http://127.0.0.1:5173` |
| `ROOM_TTL_HOURS` | Room lifetime from creation | `24` |
| `ROOM_PASSWORD_MIN_LENGTH` | Minimum new Room password length (4–72) | `4` |
| `VITE_SOCKET_URL` | Socket.IO server URL embedded at frontend build time | `http://localhost:3001` |

Set `FRONTEND_ORIGINS` to the exact HTTPS frontend origin(s) in production, and set `VITE_SOCKET_URL` to the public HTTPS/WSS API origin **before building** the frontend. Do not put backend secrets in `VITE_*` variables.

## Video and audio assets

The backdrop video at `frontend/public/assets/video/backdrop.MP4` is played muted, inline, and on a loop behind the Display labels. Replace that file to customize the backdrop; retain its name or update the video source in `frontend/src/App.jsx`. If the file cannot load, the animated CSS backdrop appears instead.

`frontend/public/assets/audio/track-01.mp3` is supplied and used by the Display. The browser requires a user gesture to allow audible playback; tap the visible prompt on the Display when entering the Room. The Controller's audio panel controls mute/volume. The Display itself has no navigation or footer; press `F` to toggle fullscreen.

Only use music you have the right to play at the event. Different connected Display devices may each play audio if audio is activated on each one; for a single sound system, activate audio on only the Display connected to it.

## Deployment to cPanel Setup Node.js App

1. Confirm with the hosting provider that the plan supports a persistent Node.js application, incoming WebSocket upgrade requests, and/or Socket.IO HTTP long-polling; this cannot be verified without access to the actual cPanel account and provider configuration.
2. Build the frontend with the production `VITE_SOCKET_URL` and `FRONTEND_ORIGINS` settings. Upload `frontend/dist` to the document root of the HTTPS website (or serve it from a static subdomain).
3. Create a Setup Node.js App with a supported Node version (20+), application root set to the uploaded `backend` directory, and startup file `src/server.js`. Install backend dependencies in cPanel's application environment.
4. Configure `FRONTEND_ORIGINS`, `ROOM_TTL_HOURS`, and `ROOM_PASSWORD_MIN_LENGTH` in cPanel. The hosting platform supplies `PORT`; the server reads it and binds to `0.0.0.0`.
5. Enable HTTPS for the frontend and API host. Configure the provider's reverse proxy so `/socket.io/` preserves HTTP upgrade headers for WebSocket; allow long-lived requests for the polling transport as well. If the provider runs multiple application workers, use sticky sessions for polling or configure a single worker.
6. Open `/api/health`, then test a Controller on a mobile data connection and a Display on another network. Test upgrade to WebSocket, polling fallback, reconnect, and a Room timer across an application restart before using it at an event.

Socket.IO is configured with both WebSocket and polling transports, so it can fall back to polling if an upgrade is unavailable. This does not guarantee that a given cPanel provider allows sufficiently long-running connections; confirm and test that behavior with the provider. The app does not silently substitute a paid service.

### Storage and restart limitation

This initial implementation stores Rooms, active timer state, and session hashes in process memory. A backend restart, deployment, or process crash loses every Room, including its running timer; reconnect sessions cannot restore a lost Room. The app intentionally reports the Room as unavailable instead of pretending it recovered. For production events that require restart recovery, move the Room/session/state store to a persistent database supported by the host (such as MySQL/MariaDB), and persist timer timestamps and revisions. No database or Redis service is included.

## Project layout

```text
backend/
  src/server.js       Express, Socket.IO events, expiration and finish checks
  src/rooms.js        Room/session membership and authorization
  src/timer.js        Pure timer state machine and level configuration
  test/               Timer and Room-manager tests
frontend/
  src/App.jsx         Landing, Room forms, Controller, Display, audio engine
  src/styles.css      Responsive controller and large-screen presentation
  public/assets/audio/  Supplied track and optional licensed playlist tracks
  public/assets/video/backdrop.MP4  Looping Display backdrop video
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
