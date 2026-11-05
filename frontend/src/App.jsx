import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  ArrowDownRight, ArrowLeft, ArrowRight, AudioLines, Check, ChevronDown, CircleHelp,
  Copy, Crown, Headphones, Link2, LockKeyhole, MonitorPlay,
  Pause, Play, RotateCcw, ShieldCheck, Sparkles,
  Volume2, VolumeX, Wifi, X
} from "lucide-react";

const API_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);
const LEVELS = [
  { id: "mosaic", title: "Mosaic", details: "Mosaic", duration: "20 MIN", hue: "orange" },
  { id: "fwm", title: "FWM", details: "Fun With Machine", duration: "20 MIN", hue: "blue" },
  { id: "fwp", title: "FWP", details: "Fun With Programming", duration: "60 MIN", hue: "yellow" },
  { id: "mechanic-engineering", title: "Mechanic Engineering", details: "Mechanic Engineering", duration: "60 MIN", hue: "lilac" },
  { id: "programming", title: "Programming", details: "Programming", duration: "120 MIN", hue: "orange" }
];
const TRACKS = [
  { id: "track-01", src: "/assets/audio/track-01.mp3", title: "Track 01" }
];
const SESSION_KEY = "vaytes-room-session";

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}

function writeSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function forgetSession() {
  localStorage.removeItem(SESSION_KEY);
}

function formatTime(milliseconds = 0) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function remainingAt(timer, clockOffset = 0, clientNow = Date.now()) {
  if (!timer) return 0;
  if (timer.status !== "RUNNING" || timer.startedAt === null) return timer.remainingMs;
  return Math.max(0, timer.remainingMs - (clientNow + clockOffset - timer.startedAt));
}

function FlipUnit({ value, label }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [flippingValue, setFlippingValue] = useState(null);

  useEffect(() => {
    if (value === displayValue) return undefined;
    setFlippingValue(displayValue);
    setDisplayValue(value);
    return undefined;
  }, [displayValue, value]);

  useEffect(() => {
    if (flippingValue === null) return undefined;
    const timeoutId = window.setTimeout(() => setFlippingValue(null), 650);
    return () => window.clearTimeout(timeoutId);
  }, [flippingValue]);

  return <div className="flip-unit" aria-label={`${label}: ${value}`}>
    <span className="flip-unit-label">{label}</span>
    <div className="flip-card">
      <span className="flip-card-value" aria-hidden="true">{displayValue}</span>
      {flippingValue !== null && <span className="flip-page" aria-hidden="true">{flippingValue}</span>}
    </div>
  </div>;
}

function useRoomSocket() {
  const socket = useMemo(() => io(API_URL, { autoConnect: true, reconnection: true }), []);
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState(null);
  const [role, setRole] = useState(null);
  const [session, setSession] = useState(readSession);
  const sessionRef = useRef(session);
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState("");
  sessionRef.current = session;

  const acceptRoom = useCallback((result, selectedRole) => {
    const saved = { code: result.room.code, name: result.room.name, role: selectedRole, sessionToken: result.sessionToken };
    writeSession(saved);
    setSession(saved);
    setRoom(result.room);
    setRole(selectedRole);
    setError("");
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const savedSession = sessionRef.current;
      if (savedSession?.code && savedSession?.sessionToken) {
        socket.emit("room:join", {
          code: savedSession.code,
          role: savedSession.role,
          sessionToken: savedSession.sessionToken
        }, (result) => {
          if (result?.ok) acceptRoom(result, savedSession.role);
          else {
            forgetSession();
            setSession(null);
            setRoom(null);
            setError(result?.error || "Could not restore the saved Room session.");
          }
        });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onState = (state) => {
      setClockOffset(state.serverNow - Date.now());
      setRoom((current) => current && state.revision >= current.state.revision ? { ...current, state } : current);
    };
    const onMembers = (members) => setRoom((current) => current ? { ...current, members } : current);
    const onClosed = () => {
      setRoom(null);
      setRole(null);
      setSession(null);
      forgetSession();
      setError("This Room has been closed by its owner.");
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onState);
    socket.on("room:members", onMembers);
    socket.on("room:closed", onClosed);
    socket.connect();
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onState);
      socket.off("room:members", onMembers);
      socket.off("room:closed", onClosed);
      socket.disconnect();
    };
  }, [socket, acceptRoom]);

  const emit = useCallback((event, payload = {}) => new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: "Not connected to the timer server. Reconnecting…" });
      return;
    }
    socket.timeout(8000).emit(event, payload, (timeoutError, result) => {
      if (timeoutError) resolve({ ok: false, error: "The server did not respond. Please try again." });
      else if (!result?.ok) resolve({ ok: false, error: result?.error || "Request failed." });
      else {
        if (result.room) {
          setRoom(result.room);
          setClockOffset(result.room.state.serverNow - Date.now());
        }
        resolve(result);
      }
    });
  }), [socket]);

  const createRoom = useCallback(async (payload) => {
    const result = await emit("room:create", payload);
    if (result.ok) acceptRoom(result, "CONTROLLER");
    else setError(result.error);
    return result;
  }, [emit, acceptRoom]);

  const joinRoom = useCallback(async (payload) => {
    const result = await emit("room:join", payload);
    if (result.ok) acceptRoom(result, payload.role);
    else setError(result.error);
    return result;
  }, [emit, acceptRoom]);

  const leaveRoom = useCallback(async () => {
    await emit("room:leave");
    forgetSession();
    setSession(null);
    setRoom(null);
    setRole(null);
  }, [emit]);

  return { socket, connected, room, role, session, clockOffset, error, setError, createRoom, joinRoom, emit, leaveRoom };
}

function Brand({ compact = false }) {
  return <a className={`brand-mark ${compact ? "brand-compact" : ""}`} href="#" aria-label="VAYTES home">VAYTES<span>®</span></a>;
}

function StatusPill({ connected }) {
  return <span className={`connection-pill ${connected ? "is-online" : "is-offline"}`}>
    <span className="connection-dot" />{connected ? "Connected" : "Reconnecting"}
  </span>;
}

function Landing({ connected, error, onCreate, onJoin, clearError }) {
  return <main className="landing-shell">
    <nav className="topbar"><Brand /><div className="topbar-center"><span>EVENT TOOLS</span><span className="nav-divider">/</span><span>COMPETITION TIMER</span></div><StatusPill connected={connected} /></nav>
    <section className="hero-grid">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-star">✳</span> THE EVENT CONTROL SYSTEM</div>
        <h1>Keep the<br /><em>moment.</em><br />Own the clock<span className="orange-period">.</span></h1>
        <p className="hero-description">One phone runs the show.<br />Every screen stays in sync.</p>
        <div className="hero-bottom">
          <div className="scribble-arrow"><ArrowDownRight size={35} strokeWidth={1.5} /></div>
          <span>BUILT FOR THE BIG MOMENTS<br />AND EVERY SECOND IN BETWEEN.</span>
        </div>
        <div className="hero-index">01 — 05 <span>● ● ● ● ●</span></div>
      </div>
      <div className="hero-art">
        <div className="paper-grid" />
        <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
        <span className="art-note note-top">THE SHOW<br />MUST GO ON ↗</span>
        <span className="art-note note-side">NO MORE<br />RUNNING BACK<br />TO THE LAPTOP.</span>
        <div className="timer-poster">
          <span className="poster-label">LIVE · ROUND ONE</span>
          <div className="poster-time">00<span>:</span>20<span>:</span>00</div>
          <div className="poster-line"><span /> FIVE LEVELS. ONE CONTROL.</div>
          <div className="poster-sticker">READY<br />WHEN<br />YOU ARE<span>✳</span></div>
          <div className="poster-bottom">VAYTES / EVENT CONTROL / EST. 2025</div>
        </div>
        <div className="art-spark spark-a">✳</div><div className="art-spark spark-b">✳</div>
        <div className="hero-art-caption">ALL EYES UP FRONT.<br /><b>ALL CONTROL IN YOUR HAND.</b></div>
      </div>
    </section>
    <section className="action-strip">
      <div className="strip-intro"><span className="eyebrow">START HERE</span><strong>Set the room.<br />Run the event.</strong></div>
      <button className="action-card create-card" onClick={onCreate}>
        <span className="action-number">01 / CONTROL</span><Crown size={22} />
        <span className="action-title">Create a room</span><span className="action-copy">Set up a protected space<br />for your event.</span>
        <span className="action-link">START A ROOM <ArrowRight size={15} /></span>
      </button>
      <button className="action-card join-card" onClick={onJoin}>
        <span className="action-number">02 / DISPLAY</span><MonitorPlay size={22} />
        <span className="action-title">Join a room</span><span className="action-copy">Connect a controller or<br />big-screen display.</span>
        <span className="action-link">ENTER A ROOM <ArrowRight size={15} /></span>
      </button>
      <div className="strip-note"><ShieldCheck size={18} /><span>PRIVATE BY DESIGN.<br /><b>CONTROLLED BY YOU.</b></span></div>
    </section>
    <footer className="landing-footer"><Brand compact /><span>MAKE EVERY SECOND COUNT.</span><span>© VAYTES 2025</span></footer>
    {error && <ToastMessage message={error} onClose={clearError} />}
  </main>;
}

function RoomForm({ mode, onBack, onCreate, onJoin, error, connected }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("CONTROLLER");
  const [busy, setBusy] = useState(false);
  const isCreate = mode === "create";

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    if (isCreate) await onCreate({ name, password });
    else await onJoin({ code: code.trim().toUpperCase(), password, role });
    setBusy(false);
  }

  return <main className="form-page">
    <nav className="topbar"><Brand /><button className="text-button" onClick={onBack}><ArrowLeft size={16} /> Back</button><StatusPill connected={connected} /></nav>
    <section className="form-layout">
      <div className="form-aside"><span className="eyebrow">VAYTES / ROOM ACCESS</span><h1>{isCreate ? <>Make your<br /><em>moment.</em></> : <>Get in.<br /><em>Get ready.</em></>}</h1><p>{isCreate ? "A private room for your team, your displays, and the moments that matter." : "One room. Two roles. Pick how you want to show up."}</p><div className="aside-index">01 <span>—</span> {isCreate ? "CREATE" : "CONNECT"}</div></div>
      <form className="room-form" onSubmit={submit}>
        <div className="form-head"><span className="eyebrow">{isCreate ? "NEW SESSION" : "JOIN SESSION"}</span><span className="form-step">01 / 01</span></div>
        {isCreate ? <label className="field-label">ROOM NAME<input autoFocus autoComplete="off" maxLength={48} minLength={2} placeholder="e.g. VAYTES Robotics Final" required value={name} onChange={(event) => setName(event.target.value)} /></label> :
          <label className="field-label">ROOM CODE<input autoFocus autoComplete="off" className="code-input" maxLength={6} minLength={6} placeholder="ABC123" required value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></label>}
        <label className="field-label">ROOM PASSWORD<input autoComplete={isCreate ? "new-password" : "current-password"} minLength={4} maxLength={72} placeholder={isCreate ? "Create a password (4+ characters)" : "Enter the room password"} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {!isCreate && <fieldset className="role-picker"><legend>THIS DEVICE IS A</legend>
          <button type="button" className={role === "CONTROLLER" ? "role-option selected" : "role-option"} onClick={() => setRole("CONTROLLER")}><span className="role-icon"><Crown size={18} /></span><span><b>Controller</b><small>Run the timer from this device</small></span>{role === "CONTROLLER" && <Check size={18} />}</button>
          <button type="button" className={role === "DISPLAY" ? "role-option selected" : "role-option"} onClick={() => setRole("DISPLAY")}><span className="role-icon"><MonitorPlay size={18} /></span><span><b>Display</b><small>Show the event on a large screen</small></span>{role === "DISPLAY" && <Check size={18} />}</button>
        </fieldset>}
        {error && <div className="inline-error" role="alert"><CircleHelp size={17} />{error}</div>}
        <button className="submit-button" disabled={busy || !connected}>{busy ? "CONNECTING…" : isCreate ? "CREATE ROOM" : "JOIN ROOM"}<ArrowRight size={18} /></button>
        <p className="form-privacy"><LockKeyhole size={13} /> Room access is protected and password-secured.</p>
      </form>
    </section>
  </main>;
}

function ToastMessage({ message, onClose }) {
  return <div className="toast-message" role="status">{message}<button aria-label="Dismiss" onClick={onClose}><X size={15} /></button></div>;
}

function LevelCard({ level, number, selected, onClick }) {
  return <button className={`level-card level-${level.hue} ${selected ? "level-selected" : ""}`} onClick={onClick}>
    <span className="level-number">{number}</span>
    <span className="level-card-time">{level.duration}</span>
    <strong>{level.title}</strong><span className="level-details">{level.details}</span>
    <span className="level-arrow"><ArrowRight size={16} /></span>
  </button>;
}

function Controller({ room, connected, clockOffset, emit, onLeave, onClose }) {
  const [notice, setNotice] = useState("");
  const [displayVolume, setDisplayVolume] = useState(room.state.audio.volume);
  const [tick, setTick] = useState(0);
  const activeLevel = LEVELS.find((level) => level.id === room.state.activeLevel);
  const timer = room.state.timer;
  const remainingMs = remainingAt(timer, clockOffset);
  const displayedStatus = timer.status === "RUNNING" && remainingMs <= 0 ? "FINISHED" : timer.status;
  const currentTimerText = formatTime(remainingMs);

  useEffect(() => {
    const interval = window.setInterval(() => setTick((value) => value + 1), 250);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => setDisplayVolume(room.state.audio.volume), [room.state.audio.volume]);

  async function command(event, payload) {
    setNotice("");
    const result = await emit(event, payload);
    if (!result.ok) setNotice(result.error);
  }

  async function selectLevel(level) {
    if (["RUNNING", "PAUSED"].includes(timer.status) &&
      !window.confirm("Switching levels will replace the current timer. Continue?")) return;
    await command("timer:select-level", { levelId: level.id, confirm: true });
  }

  async function toggleAudio() {
    await command("audio:set-mute", { muted: !room.state.audio.muted });
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("Room code copied.");
    } catch {
      setNotice(`Room code: ${room.code}`);
    }
  };

  return <main className="controller-shell">
    <header className="controller-header">
      <Brand compact />
      <div className="controller-room-name"><span className="eyebrow">LIVE ROOM</span><strong>{room.name}</strong></div>
      <button className="room-code-chip" onClick={copyCode}><Link2 size={14} /> {room.code} <Copy size={13} /></button>
      <StatusPill connected={connected} />
      <button className="icon-button mobile-menu" aria-label="Room options" onClick={() => window.confirm("Leave this room?") && onLeave()}><ChevronDown size={18} /></button>
    </header>
    <div className="controller-main">
      <section className="controller-title-row"><div><span className="eyebrow"><span className="live-dot" /> EVENT CONTROL / 01</span><h1>Good to go<span>.</span></h1><p>Your room is ready. Set the pace.</p></div><div className="device-count"><div className="device-count-icon"><MonitorPlay size={19} /></div><div><b>{room.members?.displaysOnline || 0}</b><span>DISPLAY{room.members?.displaysOnline === 1 ? "" : "S"} ONLINE</span></div><span className={`device-status ${room.members?.displaysOnline ? "active" : ""}`}>{room.members?.displaysOnline ? "CONNECTED" : "WAITING"}</span></div></section>
      <section className="control-section">
        <div className="section-heading"><span className="section-index">01</span><div><h2>Choose your stage</h2><p>Switch the big screen between backdrop and competition levels.</p></div></div>
        <div className="level-grid">
          <button className={`level-card backdrop-card ${room.state.activeView === "BACKDROP" ? "level-selected" : ""}`} onClick={() => command("display:set-view", { view: "BACKDROP" })}>
            <span className="level-number">00</span><span className="level-card-time">EVENT MODE</span><strong>Backdrop</strong><span className="level-details">Animated event screen</span><span className="level-arrow"><Sparkles size={16} /></span>
          </button>
          <button className={`level-card level-orange ${["mosaic", "fwm"].includes(room.state.activeLevel) && room.state.activeView === "TIMER" ? "level-selected" : ""}`} onClick={() => selectLevel(LEVELS[0])}>
            <span className="level-number">01–02</span><span className="level-card-time">20 MIN</span><strong>Mosaic &amp; FWM</strong><span className="level-details">Mosaic · Fun With Machine</span>
            <span className="level-arrow"><ArrowRight size={16} /></span>
          </button>
          {LEVELS.filter((level) => !["mosaic", "fwm"].includes(level.id)).map((level, index) => <LevelCard key={level.id} level={level} number={String(index + 3).padStart(2, "0")} selected={room.state.activeLevel === level.id && room.state.activeView === "TIMER"} onClick={() => selectLevel(level)} />)}
        </div>
      </section>
      <section className="dashboard-lower">
        <div className="timer-panel">
          <div className="panel-title"><span className="section-index">02</span><div><h2>Competition clock</h2><p>{activeLevel ? activeLevel.details : "Pick a level to set the clock."}</p></div><span className={`timer-status status-${displayedStatus.toLowerCase()}`}>{displayedStatus}</span></div>
          <div className="timer-readout" aria-label={`Time remaining ${currentTimerText}`} data-tick={tick}>{currentTimerText}</div>
          <div className="timer-progress"><span style={{ width: timer.durationMs ? `${Math.max(0, Math.min(100, remainingMs / timer.durationMs * 100))}%` : "0%" }} /></div>
          <div className="timer-actions">
            {displayedStatus === "RUNNING" ? <button className="control-button pause-button" onClick={() => command("timer:pause")}><Pause size={17} fill="currentColor" /> Pause</button> :
              displayedStatus === "PAUSED" ? <button className="control-button start-button" onClick={() => command("timer:resume")}><Play size={17} fill="currentColor" /> Resume</button> :
                <button className="control-button start-button" disabled={!activeLevel || displayedStatus === "FINISHED"} onClick={() => command("timer:start")}><Play size={17} fill="currentColor" /> Start timer</button>}
            <button className="control-button reset-button" disabled={!activeLevel || displayedStatus === "READY"} onClick={() => window.confirm("Reset this timer to its full duration?") && command("timer:reset")}><RotateCcw size={16} /> Reset</button>
            <button className="control-button display-button" disabled={!activeLevel} onClick={() => command("display:set-view", { view: "TIMER" })}><MonitorPlay size={16} /> Show timer</button>
          </div>
        </div>
        <div className="audio-panel">
          <div className="panel-title"><span className="section-index">03</span><div><h2>Room audio</h2><p>Plays from the Display device only.</p></div><span className="audio-wave"><AudioLines size={17} /></span></div>
          <div className="audio-control-row"><div className="audio-icon"><Headphones size={20} /></div><div className="audio-copy"><b>Background music</b><span>{room.state.audio.muted ? "Muted on Display" : "Volume controlled on Display"}</span></div><button className={`toggle-switch ${room.state.audio.muted ? "" : "toggle-on"}`} aria-label={room.state.audio.muted ? "Unmute audio" : "Mute audio"} onClick={toggleAudio}><span /></button></div>
          <label className="volume-row"><VolumeX size={16} /><input type="range" min="0" max="1" step="0.01" value={displayVolume} aria-label="Display volume" onChange={(event) => setDisplayVolume(Number(event.target.value))} onPointerUp={() => command("audio:set-volume", { volume: displayVolume })} onKeyUp={() => command("audio:set-volume", { volume: displayVolume })} /><Volume2 size={17} /><span>{Math.round(displayVolume * 100)}%</span></label>
          <div className="audio-footnote"><span className="audio-note-dot" /> Tap the Display once to enable audio. Press F for fullscreen.</div>
        </div>
      </section>
    </div>
    <footer className="controller-footer"><span><Wifi size={14} /> ALL DISPLAYS SYNCED IN REAL TIME</span><button onClick={() => window.confirm("Close this Room for all connected devices?") && onClose()}>CLOSE ROOM</button><button onClick={() => window.confirm("Leave this room?") && onLeave()}>LEAVE ROOM</button><Brand compact /></footer>
    {notice && <ToastMessage message={notice} onClose={() => setNotice("")} />}
  </main>;
}

const AudioEngine = forwardRef(function AudioEngine({ socket, audioState, onStatus }, ref) {
  const audioRef = useRef(null);
  const enabledRef = useRef(false);
  const failedTracksRef = useRef(new Set());
  const lastTrackRef = useRef(null);
  const activeTrackRef = useRef(null);
  const playTrackRef = useRef(null);
  const loadTimeoutRef = useRef(null);

  const selectTrack = useCallback(() => {
    const available = TRACKS.map((_, index) => index).filter((index) => !failedTracksRef.current.has(index));
    if (!available.length) return null;
    let candidates = available.filter((index) => index !== lastTrackRef.current);
    if (!candidates.length) candidates = available;
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    lastTrackRef.current = next;
    return next;
  }, []);

  const playNextTrack = useCallback(() => {
    const next = selectTrack();
    if (next === null) {
      onStatus("unavailable");
      return;
    }
    activeTrackRef.current = next;
    const audio = audioRef.current;
    if (!audio) return;
    window.clearTimeout(loadTimeoutRef.current);
    audio.src = TRACKS[next].src;
    loadTimeoutRef.current = window.setTimeout(() => {
      if (activeTrackRef.current !== next) return;
      failedTracksRef.current.add(next);
      activeTrackRef.current = null;
      onStatus("unavailable");
    }, 30_000);
    audio.play().catch(() => onStatus("blocked"));
  }, [onStatus, selectTrack]);
  playTrackRef.current = playNextTrack;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = audioState.volume;
    audio.muted = audioState.muted;
  }, [audioState.volume, audioState.muted]);

  const activate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    enabledRef.current = true;
    onStatus("starting");
    if (activeTrackRef.current === null) {
      if (!TRACKS.some((_, index) => !failedTracksRef.current.has(index))) {
        failedTracksRef.current.clear();
      }
      playNextTrack();
    } else {
      audio.play().catch(() => onStatus("blocked"));
    }
  }, [onStatus, playNextTrack]);

  useImperativeHandle(ref, () => ({ activate }), [activate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onPlaying = () => {
      window.clearTimeout(loadTimeoutRef.current);
      const index = activeTrackRef.current;
      onStatus("playing");
      if (index !== null) socket.emit("audio:track-changed", { trackId: TRACKS[index].id });
    };
    const onError = () => {
      window.clearTimeout(loadTimeoutRef.current);
      const failedTrack = activeTrackRef.current;
      if (failedTrack === null) return;
      failedTracksRef.current.add(failedTrack);
      activeTrackRef.current = null;
      if (enabledRef.current) {
        playTrackRef.current?.();
      } else {
        onStatus("unavailable");
      }
    };
    const onEnded = () => {
      window.clearTimeout(loadTimeoutRef.current);
      activeTrackRef.current = null;
      playTrackRef.current?.();
    };
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);
    return () => {
      window.clearTimeout(loadTimeoutRef.current);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("ended", onEnded);
    };
  }, [onStatus, socket]);

  return <audio ref={audioRef} preload="auto" />;
});

function Display({ room, clockOffset, socket }) {
  const audioEngineRef = useRef(null);
  const [audioStatus, setAudioStatus] = useState("prompt");
  const [clientNow, setClientNow] = useState(Date.now());
  const level = LEVELS.find((item) => item.id === room.state.activeLevel);
  const isBackdrop = room.state.activeView === "BACKDROP" || !level;
  const remaining = remainingAt(room.state.timer, clockOffset, clientNow);
  const finished = room.state.timer.status === "FINISHED" || (room.state.timer.status === "RUNNING" && remaining <= 0);
  const timerParts = formatTime(remaining).split(":");
  const displayTitle = ["mosaic", "fwm"].includes(level?.id) ? "Mosaic & FWM" : level?.title;

  useEffect(() => {
    const intervalId = window.setInterval(() => setClientNow(Date.now()), 250);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key.toLowerCase() !== "f" || event.altKey || event.ctrlKey || event.metaKey) return;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return <main className={`display-stage ${isBackdrop ? "display-backdrop-mode" : "display-timer-mode"} ${finished ? "display-finished" : ""}`}>
    <video
      className="backdrop-video"
      src="/assets/video/backdrop.MP4"
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
    />
    {isBackdrop ? null : <section className="timer-scene">
      <h1 className="timer-level-title">{displayTitle}</h1>
      <div className={`flip-clock ${finished ? "clock-finished" : ""}`} role="timer" aria-label={`Time remaining ${formatTime(remaining)}`}>
        <FlipUnit value={timerParts[0]} label="Hours" />
        <span className="flip-clock-separator" aria-hidden="true">:</span>
        <FlipUnit value={timerParts[1]} label="Minutes" />
        <span className="flip-clock-separator" aria-hidden="true">:</span>
        <FlipUnit value={timerParts[2]} label="Seconds" />
      </div>
    </section>}
    <AudioEngine ref={audioEngineRef} socket={socket} audioState={room.state.audio} onStatus={setAudioStatus} />
    {audioStatus !== "playing" && <button className="display-audio-prompt" onClick={() => audioEngineRef.current?.activate()}>
      {audioStatus === "prompt" && <>Tap to enable event audio</>}
      {audioStatus === "starting" && <>Starting audio…</>}
      {audioStatus === "blocked" && <>Audio was blocked. Tap to try again.</>}
      {audioStatus === "unavailable" && <>Audio is unavailable. Tap to retry.</>}
    </button>}
  </main>;
}

export default function App() {
  const state = useRoomSocket();
  const [page, setPage] = useState("home");

  useEffect(() => {
    if (state.room) setPage("room");
    else if (page === "room") setPage("home");
  }, [state.room, page]);

  if (state.room && state.role === "CONTROLLER") return <Controller room={state.room} connected={state.connected} clockOffset={state.clockOffset} emit={state.emit} onLeave={state.leaveRoom} onClose={async () => { const result = await state.emit("room:close"); if (!result.ok) state.setError(result.error); }} />;
  if (state.room && state.role === "DISPLAY") return <Display room={state.room} clockOffset={state.clockOffset} socket={state.socket} />;

  return page === "home" ?
    <Landing connected={state.connected} error={state.error} clearError={() => state.setError("")} onCreate={() => { state.setError(""); setPage("create"); }} onJoin={() => { state.setError(""); setPage("join"); }} /> :
    <RoomForm mode={page} connected={state.connected} error={state.error} onBack={() => { state.setError(""); setPage("home"); }} onCreate={state.createRoom} onJoin={state.joinRoom} />;
}
