import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Award, Camera, Check, Clock3, FileImage, FileVideo,
  FolderOpen, LogOut, Medal, Search, ShieldCheck, Trophy, Upload, UsersRound, Video, X
} from "lucide-react";

const API_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);
const TOKEN_KEY = "vaytes-scoring-session";

async function request(path, token, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_URL}/api/scoring${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The scoring service could not complete this request.");
  return result;
}

function formatTime(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(millis).padStart(3, "0")}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function podiumLabel(place) {
  return ["1ST PLACE", "2ND PLACE", "3RD PLACE"][place - 1];
}

function ScoringLogin({ onLogin, onBack, status, error, busy }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event) {
    event.preventDefault();
    await onLogin(username, password);
  }

  return <main className="scoring-login-page">
    <header className="scoring-login-header">
      <a className="brand-mark" href="#" onClick={(event) => { event.preventDefault(); onBack(); }}>VAYTES<span>®</span></a>
      <button className="scoring-back-button" onClick={onBack}><ArrowLeft size={16} /> Back to event tools</button>
    </header>
    <section className="scoring-login-layout">
      <div className="scoring-login-copy">
        <span className="scoring-eyebrow"><span className="scoring-live-dot" /> COMPETITION / SCORING DESK</span>
        <h1>Every point.<br /><em>In its place.</em></h1>
        <p>Record attempts, see the podium update, and keep project evidence close at hand.</p>
        <div className="scoring-login-note"><ShieldCheck size={18} /><span>Separate from event rooms.<br /><b>Available whenever you need it.</b></span></div>
      </div>
      <form className="scoring-login-card" onSubmit={submit}>
        <div className="scoring-card-top"><div className="scoring-card-icon"><Trophy size={21} /></div><span className="scoring-eyebrow">STAFF ACCESS</span></div>
        <h2>Welcome back.</h2>
        <p>Sign in with your assistant or judge account.</p>
        {!status?.enabled
          ? <div className="scoring-message scoring-warning" role="status">Scoring is not configured yet. Ask your administrator to connect MySQL.</div>
          : !status.ready && <div className="scoring-message scoring-warning" role="status">The scoring database is not ready yet. Please try again shortly.</div>}
        {error && <div className="scoring-message scoring-error" role="alert">{error}</div>}
        <label className="scoring-field">USERNAME
          <input autoComplete="username" autoCapitalize="none" required value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label className="scoring-field">PASSWORD
          <input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="scoring-primary-button" disabled={busy || !status?.ready}>
          {busy ? "SIGNING IN…" : "SIGN IN"}<ArrowRight size={17} />
        </button>
        <div className="scoring-session-note"><ShieldCheck size={14} /> Your sign-in stays active for up to a year.</div>
      </form>
    </section>
  </main>;
}

function Podium({ winners }) {
  return <section className="scoring-panel scoring-podium-panel">
    <div className="scoring-section-heading">
      <div className="scoring-heading-icon scoring-heading-gold"><Trophy size={18} /></div>
      <div><h2>Current podium</h2><p>Best score, fastest time, then youngest age.</p></div>
    </div>
    <div className="scoring-podium">
      {[1, 2, 3].map((place) => {
        const winner = winners.find((item) => item.place === place);
        return <article className={`scoring-podium-place scoring-place-${place}`} key={place}>
          <span className="scoring-place-number"><Medal size={16} /> {podiumLabel(place)}</span>
          {winner ? <>
            <strong>{winner.name}</strong>
            <span className="scoring-podium-result">{Number(winner.bestAttempt.score).toLocaleString()} <small>PTS</small></span>
            <span className="scoring-podium-time"><Clock3 size={13} /> {formatTime(winner.bestAttempt.durationMs)}</span>
          </> : <span className="scoring-place-empty">Waiting for a scored entry</span>}
        </article>;
      })}
    </div>
  </section>;
}

function AttemptEditor({ participant, attemptNumber, onSave, saving }) {
  const existing = participant.attempts.find((attempt) => attempt.attemptNumber === attemptNumber);
  const [score, setScore] = useState(existing ? String(existing.score) : "");
  const [minutes, setMinutes] = useState(existing ? String(Math.floor(existing.durationMs / 60_000)) : "");
  const [seconds, setSeconds] = useState(existing ? String(Math.floor((existing.durationMs % 60_000) / 1000)) : "");
  const [millis, setMillis] = useState(existing ? String(existing.durationMs % 1000) : "");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    setScore(existing ? String(existing.score) : "");
    setMinutes(existing ? String(Math.floor(existing.durationMs / 60_000)) : "");
    setSeconds(existing ? String(Math.floor((existing.durationMs % 60_000) / 1000)) : "");
    setMillis(existing ? String(existing.durationMs % 1000) : "");
  }, [existing, participant.id]);

  async function submit(event) {
    event.preventDefault();
    const timeParts = [minutes, seconds, millis].map((part) => part.trim() === "" ? 0 : Number(part));
    const durationMs = timeParts[0] * 60_000 + timeParts[1] * 1000 + timeParts[2];
    if (!score.trim() || !Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 1_000_000 ||
      timeParts.some((part) => !Number.isInteger(part) || part < 0) || timeParts[1] > 59 || timeParts[2] > 999 ||
      durationMs < 1 || durationMs > 7 * 24 * 60 * 60 * 1000) {
      setValidationError("Enter a score and a completion time greater than 00:00:000.");
      return;
    }
    setValidationError("");
    await onSave({
      attemptNumber,
      score: Number(score),
      durationMs
    });
  }

  return <form className="scoring-attempt-row" onSubmit={submit}>
    <div className="scoring-attempt-title"><span>ATTEMPT {String(attemptNumber).padStart(2, "0")}</span>{existing && <span className="scoring-saved"><Check size={12} /> SAVED</span>}</div>
    <div className="scoring-attempt-fields">
      <label className="scoring-small-field">POINTS<input aria-label={`Attempt ${attemptNumber} points`} min="0" max="1000000" step="0.01" type="number" placeholder="0" required value={score} onChange={(event) => setScore(event.target.value)} /></label>
      <div className="scoring-time-inputs">
        <label className="scoring-small-field">MIN<input aria-label={`Attempt ${attemptNumber} minutes`} min="0" max="10080" type="number" placeholder="00" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
        <span>:</span>
        <label className="scoring-small-field">SEC<input aria-label={`Attempt ${attemptNumber} seconds`} min="0" max="59" type="number" placeholder="00" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></label>
        <span>:</span>
        <label className="scoring-small-field">MS<input aria-label={`Attempt ${attemptNumber} milliseconds`} min="0" max="999" type="number" placeholder="000" value={millis} onChange={(event) => setMillis(event.target.value)} /></label>
      </div>
      <button className="scoring-save-button" disabled={saving}>{saving ? "SAVING…" : existing ? "UPDATE" : "SAVE"}</button>
    </div>
    {validationError && <div className="scoring-attempt-error" role="alert">{validationError}</div>}
  </form>;
}

async function optimizePhoto(file) {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return file;
  const bitmap = await createImageBitmap(file);
  try {
    if (file.size < 900_000 && Math.max(bitmap.width, bitmap.height) <= 1920) return file;
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 2_000_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the photo for upload.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

function MediaSection({ participant, media, token, onUploaded, error, setError }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(null);
  const [openingId, setOpeningId] = useState("");
  const galleryInput = useRef(null);
  const photoInput = useRef(null);
  const videoInput = useRef(null);

  useEffect(() => () => {
    if (preview?.url?.startsWith("blob:")) URL.revokeObjectURL(preview.url);
  }, [preview]);

  async function uploadFile(file) {
    setError("");
    setUploading(true);
    setProgress(0);
    try {
      const prepared = await optimizePhoto(file);
      const formData = new FormData();
      formData.append("file", prepared);
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_URL}/api/scoring/participants/${participant.id}/media`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          let result = {};
          try { result = JSON.parse(xhr.responseText); } catch { result = {}; }
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(result.error || "The file could not be uploaded."));
        };
        xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
        xhr.send(formData);
      });
      await onUploaded();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(event) {
    const [file] = event.target.files || [];
    event.target.value = "";
    if (file) uploadFile(file);
  }

  async function openMedia(item) {
    setOpeningId(item.id);
    setError("");
    try {
      if (item.mimeType.startsWith("video/")) {
        const { ticket } = await request(`/media/${item.id}/access`, token, { method: "POST" });
        setPreview({
          url: `${API_URL}/api/scoring/media/${item.id}/stream?ticket=${encodeURIComponent(ticket)}`,
          mimeType: item.mimeType,
          name: item.name
        });
      } else {
        const response = await fetch(`${API_URL}/api/scoring/media/${item.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "This media file could not be opened.");
        }
        const blob = await response.blob();
        setPreview({ url: URL.createObjectURL(blob), mimeType: item.mimeType, name: item.name });
      }
    } catch (openError) {
      setError(openError.message);
    } finally {
      setOpeningId("");
    }
  }

  function closePreview() {
    if (preview?.url?.startsWith("blob:")) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  return <>
    <section className="scoring-panel scoring-media-panel">
      <div className="scoring-section-heading">
        <div className="scoring-heading-icon scoring-heading-blue"><Upload size={17} /></div>
        <div><h2>Project evidence</h2><p>Photos and mission videos for {participant.name}.</p></div>
      </div>
      <div className={`scoring-upload-zone ${uploading ? "is-uploading" : ""}`}>
        <span className="scoring-upload-icon"><Upload size={20} /></span>
        <strong>{uploading ? `Uploading ${progress}%` : "Add project evidence"}</strong>
        <span>{uploading ? "Keep this page open until the upload finishes." : "Choose from your device or capture new evidence · up to 200 MB"}</span>
        {uploading && <span className="scoring-upload-track"><i style={{ width: `${progress}%` }} /></span>}
      </div>
      <input ref={galleryInput} className="scoring-file-input" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" disabled={uploading} onChange={handleFileChange} />
      <input ref={photoInput} className="scoring-file-input" type="file" accept="image/*" capture="environment" disabled={uploading} onChange={handleFileChange} />
      <input ref={videoInput} className="scoring-file-input" type="file" accept="video/*" capture="environment" disabled={uploading} onChange={handleFileChange} />
      <div className="scoring-media-actions">
        <button type="button" onClick={() => galleryInput.current?.click()} disabled={uploading}><FolderOpen size={16} /><span>Choose from device</span></button>
        <button type="button" onClick={() => photoInput.current?.click()} disabled={uploading}><Camera size={16} /><span>Take a photo</span></button>
        <button type="button" onClick={() => videoInput.current?.click()} disabled={uploading}><Video size={16} /><span>Record a video</span></button>
      </div>
      <p className="scoring-camera-note">Camera access depends on your browser and device. Use the site over HTTPS on mobile.</p>
      {media.length > 0 ? <div className="scoring-media-list">
        {media.map((item) => {
          const isVideo = item.mimeType.startsWith("video/");
          return <button className="scoring-media-item" key={item.id} onClick={() => openMedia(item)} disabled={Boolean(openingId)}>
            <span className="scoring-media-type">{isVideo ? <FileVideo size={17} /> : <FileImage size={17} />}</span>
            <span className="scoring-media-copy"><strong>{item.name}</strong><small>{isVideo ? "VIDEO" : "PHOTO"} · {formatBytes(item.size)}</small></span>
            <span className="scoring-media-open">{openingId === item.id ? "OPENING…" : "VIEW"}</span>
          </button>;
        })}
      </div> : <div className="scoring-media-empty">No evidence uploaded yet. Files are loaded only when you open them.</div>}
      {error && <div className="scoring-message scoring-error" role="alert">{error}</div>}
    </section>
    {preview && <div className="scoring-preview-backdrop" role="presentation" onClick={closePreview}>
      <section className="scoring-preview" role="dialog" aria-modal="true" aria-label={preview.name} onClick={(event) => event.stopPropagation()}>
        <header><strong>{preview.name}</strong><button aria-label="Close preview" onClick={closePreview}><X size={19} /></button></header>
        {preview.mimeType.startsWith("video/")
          ? <video src={preview.url} controls autoPlay playsInline />
          : <img src={preview.url} alt={preview.name} />}
      </section>
    </div>}
  </>;
}

function ResultsSummary({ token, user, onBack, onLogout }) {
  const [levels, setLevels] = useState([]);
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    request("/results", token)
      .then(({ levels: result }) => { if (active) setLevels(result); })
      .catch((loadError) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const filteredLevels = useMemo(() => levels
    .filter((level) => levelFilter === "all" || level.id === levelFilter)
    .map((level) => ({
      ...level,
      participants: level.participants.filter((participant) =>
        participant.name.toLowerCase().includes(query.trim().toLowerCase()))
    }))
    .filter((level) => level.participants.length > 0 || (!query.trim() && levelFilter !== "all")),
  [levels, levelFilter, query]);
  const participantCount = levels.reduce((total, level) => total + level.participants.length, 0);

  return <main className="scoring-desk">
    <header className="scoring-desk-header">
      <a className="brand-mark" href="#" onClick={(event) => { event.preventDefault(); onBack(); }}>VAYTES<span>®</span></a>
      <button className="scoring-back-button scoring-results-back" onClick={onBack}><ArrowLeft size={15} /> Scoring desk</button>
      <div className="scoring-account"><span className="scoring-role-chip">JURI</span><span className="scoring-account-name">{user.username}</span><button aria-label="Sign out" title="Sign out" onClick={onLogout}><LogOut size={17} /></button></div>
    </header>
    <div className="scoring-content">
      <section className="scoring-page-heading">
        <div><span className="scoring-eyebrow"><span className="scoring-live-dot" /> JURI / HASIL KOMPETISI</span><h1>Participant results<span>.</span></h1><p>All registered participants and their best recorded results, grouped by level.</p></div>
        <div className="scoring-participant-count"><UsersRound size={18} /><span><b>{participantCount}</b> PARTICIPANTS</span></div>
      </section>
      {error && <div className="scoring-message scoring-error" role="alert">{error}</div>}
      <section className="scoring-results-toolbar">
        <label className="scoring-results-search"><Search size={17} /><input aria-label="Search participants" placeholder="Search participant name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="scoring-results-filter">LEVEL
          <select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
            <option value="all">All levels</option>
            {levels.map((level) => <option value={level.id} key={level.id}>{level.name}</option>)}
          </select>
        </label>
      </section>
      {loading ? <section className="scoring-panel scoring-results-empty">Loading participant results…</section> :
        filteredLevels.length ? <div className="scoring-results-groups">
          {filteredLevels.map((level) => <section className="scoring-panel scoring-results-group" key={level.id}>
            <header className="scoring-results-group-heading">
              <div><span className="scoring-level-number">{level.attempts} EVALUATION{level.attempts === 1 ? "" : "S"}</span><h2>{level.name}</h2></div>
              <span>{level.participants.length} PARTICIPANT{level.participants.length === 1 ? "" : "S"}</span>
            </header>
            <div className="scoring-results-columns"><span>RANK</span><span>PARTICIPANT</span><span>BEST SCORE</span><span>COMPLETION TIME</span><span>ATTEMPTS</span></div>
            <div className="scoring-results-list">
              {level.participants.length ? level.participants.map((participant) => <article className="scoring-results-row" key={participant.id}>
                <span className={`scoring-result-rank ${participant.place && participant.place <= 3 ? `rank-${participant.place}` : ""}`}>
                  {participant.place ? `#${participant.place}` : "—"}
                </span>
                <span className="scoring-result-name"><strong>{participant.name}</strong><small>DOB · {participant.birthDate}</small></span>
                <span className="scoring-result-value">{participant.bestAttempt ? `${Number(participant.bestAttempt.score).toLocaleString()} pts` : "Not scored"}</span>
                <span className="scoring-result-time">{participant.bestAttempt ? formatTime(participant.bestAttempt.durationMs) : "—"}</span>
                <span className="scoring-result-attempts">{participant.attempts.length}/{level.attempts}</span>
              </article>) : <div className="scoring-results-no-entries">No participants in this level yet.</div>}
            </div>
          </section>)}
        </div> : <section className="scoring-panel scoring-results-empty">
          {query ? "No participants match your search." : "No participants are registered yet."}
        </section>}
      <footer className="scoring-footer"><span><ShieldCheck size={14} /> JURI-ONLY RESULTS</span><button onClick={onBack}><ArrowLeft size={14} /> SCORING DESK</button><button onClick={onLogout}>SIGN OUT</button></footer>
    </div>
    <div className="scoring-mobile-back"><button onClick={onBack}><ArrowLeft size={15} /> Scoring desk</button><button onClick={onLogout}>Sign out</button></div>
  </main>;
}

function ScoringDesk({ token, user, onLogout, onBack }) {
  const [levels, setLevels] = useState([]);
  const [levelId, setLevelId] = useState("");
  const [participants, setParticipants] = useState([]);
  const [winners, setWinners] = useState([]);
  const [maxAttempts, setMaxAttempts] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [savingParticipant, setSavingParticipant] = useState(false);
  const [savingAttempt, setSavingAttempt] = useState(0);
  const [showResults, setShowResults] = useState(false);

  const selectedParticipant = useMemo(
    () => participants.find((participant) => participant.id === selectedId) || null,
    [participants, selectedId]
  );
  const isJudge = user.role === "juri";

  const loadParticipants = useCallback(async (requestedLevel = levelId) => {
    if (!requestedLevel) return;
    setLoading(true);
    setPageError("");
    try {
      const result = await request(`/participants?levelId=${encodeURIComponent(requestedLevel)}`, token);
      setParticipants(result.participants);
      setWinners(result.winners);
      setMaxAttempts(result.maxAttempts);
      setSelectedId((current) => result.participants.some((item) => item.id === current)
        ? current : result.participants[0]?.id || "");
    } catch (error) {
      setPageError(error.message);
    } finally {
      setLoading(false);
    }
  }, [token, levelId]);

  useEffect(() => {
    if (showResults) return undefined;
    request("/levels", token)
      .then(({ levels: available }) => {
        setLevels(available);
        setLevelId((current) => current || available[0]?.id || "");
      })
      .catch((error) => setPageError(error.message));
    return undefined;
  }, [token, showResults]);

  useEffect(() => { if (!showResults && levelId) loadParticipants(levelId); }, [levelId, loadParticipants, showResults]);

  useEffect(() => {
    if (showResults || !selectedId) {
      setMedia([]);
      return undefined;
    }
    let active = true;
    request(`/participants/${selectedId}/media`, token)
      .then(({ media: files }) => { if (active) setMedia(files); })
      .catch((error) => { if (active) setPageError(error.message); });
    return () => { active = false; };
  }, [selectedId, token, showResults]);

  if (isJudge && showResults) {
    return <ResultsSummary token={token} user={user} onBack={() => setShowResults(false)} onLogout={onLogout} />;
  }

  async function createParticipant(event) {
    event.preventDefault();
    setSavingParticipant(true);
    setFormError("");
    try {
      const result = await request("/participants", token, {
        method: "POST",
        body: JSON.stringify({ levelId, name, birthDate })
      });
      setName("");
      setBirthDate("");
      await loadParticipants(levelId);
      setSelectedId(result.participant.id);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSavingParticipant(false);
    }
  }

  async function saveAttempt(attempt) {
    setSavingAttempt(attempt.attemptNumber);
    setPageError("");
    try {
      await request(`/participants/${selectedParticipant.id}/attempts`, token, {
        method: "PUT",
        body: JSON.stringify({ ...attempt, levelId })
      });
      await loadParticipants(levelId);
    } catch (error) {
      setPageError(error.message);
    } finally {
      setSavingAttempt(0);
    }
  }

  return <main className="scoring-desk">
    <header className="scoring-desk-header">
      <a className="brand-mark" href="#" onClick={(event) => { event.preventDefault(); onBack(); }}>VAYTES<span>®</span></a>
      <div className="scoring-desk-breadcrumb"><span>EVENT TOOLS</span><b>/</b><strong>SCORING DESK</strong></div>
      {isJudge && <button className="scoring-results-nav" onClick={() => setShowResults(true)}><Trophy size={15} /> Results summary</button>}
      <div className="scoring-account"><span className="scoring-role-chip">{isJudge ? "JURI" : "ASISTEN"}</span><span className="scoring-account-name">{user.username}</span><button aria-label="Sign out" title="Sign out" onClick={onLogout}><LogOut size={17} /></button></div>
    </header>
    <div className="scoring-content">
      <section className="scoring-page-heading">
        <div><span className="scoring-eyebrow"><span className="scoring-live-dot" /> INDEPENDENT EVENT WORKSPACE</span><h1>Competition desk<span>.</span></h1><p>{isJudge ? "Record every attempt. The best run sets the leaderboard." : "Capture each project and mission. Uploads stay with their participant."}</p></div>
        <div className="scoring-participant-count"><UsersRound size={18} /><span><b>{participants.length}</b> PARTICIPANTS</span></div>
      </section>
      {pageError && <div className="scoring-message scoring-error" role="alert">{pageError}<button onClick={() => loadParticipants(levelId)}>Retry</button></div>}
      <section className="scoring-level-section">
        <div className="scoring-section-caption"><span>01</span><b>SELECT A LEVEL</b><small>7 competition categories</small></div>
        <div className="scoring-level-grid">
          {levels.map((level, index) => <button
            className={`scoring-level-card ${levelId === level.id ? "is-active" : ""}`}
            key={level.id}
            onClick={() => { setLevelId(level.id); setParticipants([]); setWinners([]); setSelectedId(""); setMedia([]); setFormError(""); }}
          >
            <span className="scoring-level-number">{String(index + 1).padStart(2, "0")}</span>
            <strong>{level.name}</strong>
            <small>{isJudge ? `${level.attempts} evaluation${level.attempts === 1 ? "" : "s"}` : "Project evidence"}</small>
          </button>)}
        </div>
      </section>

      {isJudge && <Podium winners={winners} />}

      <section className="scoring-roster-section">
        <div className="scoring-section-caption"><span>{isJudge ? "02" : "02"}</span><b>PARTICIPANTS & EVIDENCE</b><small>{loading ? "Loading entries…" : `${participants.length} in this level`}</small></div>
        <div className="scoring-workspace">
          <section className="scoring-panel scoring-roster-panel">
            <div className="scoring-section-heading">
              <div className="scoring-heading-icon"><UsersRound size={17} /></div>
              <div><h2>Participants</h2><p>Select an entry to review evidence{isJudge ? " or record a score" : ""}.</p></div>
            </div>
            {isJudge && <form className="scoring-add-form" onSubmit={createParticipant}>
              <label className="scoring-field">PARTICIPANT NAME<input maxLength="100" placeholder="Full name" required value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label className="scoring-field">DATE OF BIRTH<input required type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
              {formError && <div className="scoring-message scoring-error" role="alert">{formError}</div>}
              <button className="scoring-secondary-button" disabled={savingParticipant}>{savingParticipant ? "ADDING…" : "ADD PARTICIPANT"}<ArrowRight size={15} /></button>
            </form>}
            <div className="scoring-roster-list">
              {loading ? <div className="scoring-list-empty">Loading participants…</div> : participants.length === 0
                ? <div className="scoring-list-empty">{isJudge ? "Add the first participant to start scoring." : "No participants have been added to this level yet."}</div>
                : participants.map((participant) => <button
                  className={`scoring-roster-item ${selectedId === participant.id ? "is-selected" : ""}`}
                  key={participant.id}
                  onClick={() => { setMedia([]); setSelectedId(participant.id); }}
                >
                  <span className="scoring-roster-avatar">{participant.name.trim().charAt(0).toUpperCase()}</span>
                  <span className="scoring-roster-name"><strong>{participant.name}</strong><small>DOB · {participant.birthDate}</small></span>
                  {selectedId === participant.id && <Check size={16} />}
                </button>)}
            </div>
          </section>

          <div className="scoring-detail-column">
            {selectedParticipant ? <>
              {isJudge && <section className="scoring-panel scoring-attempt-panel">
                <div className="scoring-section-heading">
                  <div className="scoring-heading-icon scoring-heading-orange"><Award size={18} /></div>
                  <div><h2>Evaluation scores</h2><p>{selectedParticipant.name} · best score and time count.</p></div>
                </div>
                <div className="scoring-attempt-list">
                  {Array.from({ length: maxAttempts }, (_, index) => <AttemptEditor
                    key={`${selectedParticipant.id}-${index + 1}`}
                    participant={selectedParticipant}
                    attemptNumber={index + 1}
                    onSave={saveAttempt}
                    saving={savingAttempt === index + 1}
                  />)}
                </div>
                <div className="scoring-tie-note"><Clock3 size={14} /> Ties break by completion time, then youngest participant.</div>
              </section>}
              <MediaSection
                key={selectedParticipant.id}
                participant={selectedParticipant}
                media={media}
                token={token}
                onUploaded={() => request(`/participants/${selectedParticipant.id}/media`, token).then(({ media: files }) => setMedia(files))}
                error={formError}
                setError={setFormError}
              />
            </> : <section className="scoring-panel scoring-detail-empty">
              <div className="scoring-empty-icon"><UsersRound size={22} /></div>
              <strong>{isJudge ? "Add or select a participant" : "Select a participant"}</strong>
              <span>{isJudge ? "Create a participant record to enter attempts and upload evidence." : "Choose a participant to attach project photos and videos."}</span>
            </section>}
          </div>
        </div>
      </section>
      <footer className="scoring-footer"><span><ShieldCheck size={14} /> PRIVATE STAFF WORKSPACE</span><button onClick={onBack}><ArrowLeft size={14} /> EVENT TOOLS</button><button onClick={onLogout}>SIGN OUT</button></footer>
    </div>
    <div className="scoring-mobile-back"><button onClick={onBack}><ArrowLeft size={15} /> Event tools</button><button onClick={onLogout}>Sign out</button></div>
  </main>;
}

export default function ScoringApp({ onBack }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let retryTimer;
    async function checkStatus() {
      let retry = false;
      try {
        const result = await request("/status", "");
        if (!active) return;
        setStatus(result);
        setError("");
        if (result.ready) {
          const savedToken = localStorage.getItem(TOKEN_KEY) || "";
          if (savedToken) {
            try {
              const profile = await request("/auth/me", savedToken);
              if (active) {
                setToken(savedToken);
                setUser(profile.user);
              }
            } catch {
              localStorage.removeItem(TOKEN_KEY);
            }
          }
        } else {
          retry = result.enabled;
        }
      } catch (statusError) {
        if (active) setError(statusError.message);
        retry = true;
      } finally {
        if (active) {
          setLoading(false);
          if (retry) retryTimer = window.setTimeout(checkStatus, 5000);
        }
      }
    }
    checkStatus();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, []);

  async function login(username, password) {
    setBusy(true);
    setError("");
    try {
      const result = await request("/auth/login", "", { method: "POST", body: JSON.stringify({ username, password }) });
      localStorage.setItem(TOKEN_KEY, result.token);
      setToken(result.token);
      setUser(result.user);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try { await request("/auth/logout", token, { method: "POST" }); }
    catch (logoutError) { setError(logoutError.message); }
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
  }

  if (loading) return <main className="scoring-loading"><div className="scoring-loading-mark"><Trophy size={22} /></div><span>Opening scoring desk…</span></main>;
  if (user && token) return <ScoringDesk token={token} user={user} onLogout={logout} onBack={onBack} />;
  return <ScoringLogin onLogin={login} onBack={onBack} status={status} error={error} busy={busy} />;
}
