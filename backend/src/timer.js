export const LEVELS = Object.freeze([
  { id: "mosaic-1d-2d", name: "Mosaic 1D & 2D", subtitle: "Building", durationMs: 20 * 60_000 },
  { id: "mosaic-3d", name: "Mosaic 3D", subtitle: "Building", durationMs: 40 * 60_000 },
  { id: "fwm", name: "Fun With Machine", subtitle: "Building", durationMs: 20 * 60_000 },
  { id: "fwp", name: "Fun With Programming", subtitle: "Building and test track", durationMs: 60 * 60_000 },
  { id: "mechanic-engineering", name: "Mechanic Engineering", subtitle: "Building and test track", durationMs: 60 * 60_000 },
  { id: "programming", name: "Programming", subtitle: "Building and test track", durationMs: 120 * 60_000 }
]);
export const DISPLAY_VIDEO_IDS = Object.freeze([
  "break",
  "closing",
  "fwp-grading",
  "fwp-scoring",
  "mechanic-grading",
  "mechanic-scoring",
  "mosaic-&-fwm-grading",
  "programming-grading",
  "programming-scoring"
]);

export class TimerCommandError extends Error {}

function rejectCommand(message) {
  throw new TimerCommandError(message);
}

function getTimer(state, levelId) {
  const timer = state.timers.find((item) => item.levelId === levelId);
  if (!timer) rejectCommand("Select a level before controlling its timer.");
  return timer;
}

export function remainingTime(timer, now = Date.now()) {
  if (timer.status !== "RUNNING" || timer.startedAt === null) return timer.remainingMs;
  return Math.max(0, timer.remainingMs - Math.max(0, now - timer.startedAt));
}

export function createInitialState(now = Date.now()) {
  return {
    activeView: "BACKDROP",
    activeVideo: null,
    displayVideoRetry: 0,
    timers: [],
    audio: { muted: false, volume: 0.35 },
    revision: 1,
    updatedAt: now
  };
}

export function applyCommand(state, command, now = Date.now()) {
  const next = structuredClone(state);

  switch (command.type) {
    case "select-level": {
      const level = LEVELS.find((item) => item.id === command.levelId);
      if (!level) rejectCommand("Unknown competition level.");
      if (state.timers.some((timer) => timer.levelId === level.id)) rejectCommand("This level is already selected.");
      if (state.timers.length >= 2) rejectCommand("Only two level timers can be selected at once.");
      next.timers.push({
        levelId: level.id,
        status: "READY",
        durationMs: level.durationMs,
        remainingMs: level.durationMs,
        startedAt: null
      });
      next.activeView = "TIMER";
      break;
    }
    case "remove-level": {
      const timer = getTimer(state, command.levelId);
      if (["RUNNING", "PAUSED"].includes(timer.status) && !command.confirm) {
        rejectCommand("Confirm removing the active timer before switching levels.");
      }
      next.timers = next.timers.filter((item) => item.levelId !== command.levelId);
      if (!next.timers.length && next.activeView === "TIMER") next.activeView = "BACKDROP";
      break;
    }
    case "set-view":
      if (!["BACKDROP", "TIMER"].includes(command.view)) rejectCommand("Invalid display view.");
      if (command.view === "TIMER" && !state.timers.length) rejectCommand("Select a level before showing the timer.");
      next.activeView = command.view;
      break;
    case "set-video":
      if (!DISPLAY_VIDEO_IDS.includes(command.videoId)) rejectCommand("Unknown display video.");
      next.activeVideo = command.videoId;
      next.activeView = "VIDEO";
      break;
    case "retry-video":
      next.displayVideoRetry += 1;
      break;
    case "start": {
      const timer = getTimer(state, command.levelId);
      if (timer.status !== "READY") rejectCommand("The timer is not ready to start.");
      replaceTimer(next, command.levelId, { ...timer, status: "RUNNING", startedAt: now });
      break;
    }
    case "pause": {
      const timer = getTimer(state, command.levelId);
      if (timer.status !== "RUNNING") rejectCommand("Only a running timer can be paused.");
      replaceTimer(next, command.levelId, {
        ...timer,
        status: "PAUSED",
        remainingMs: remainingTime(timer, now),
        startedAt: null
      });
      break;
    }
    case "resume": {
      const timer = getTimer(state, command.levelId);
      const currentRemaining = remainingTime(timer, now);
      if (timer.status !== "PAUSED" || currentRemaining <= 0) rejectCommand("The timer cannot be resumed.");
      replaceTimer(next, command.levelId, {
        ...timer,
        status: "RUNNING",
        remainingMs: currentRemaining,
        startedAt: now
      });
      break;
    }
    case "reset": {
      const timer = getTimer(state, command.levelId);
      replaceTimer(next, command.levelId, {
        ...timer,
        status: "READY",
        remainingMs: timer.durationMs,
        startedAt: null
      });
      break;
    }
    case "set-mute":
      if (typeof command.muted !== "boolean") rejectCommand("Invalid mute setting.");
      next.audio.muted = command.muted;
      break;
    case "set-volume":
      if (!Number.isFinite(command.volume) || command.volume < 0 || command.volume > 1) {
        rejectCommand("Volume must be between 0 and 1.");
      }
      next.audio.volume = command.volume;
      break;
    default:
      rejectCommand("Unsupported command.");
  }

  next.revision += 1;
  next.updatedAt = now;
  return next;
}

function replaceTimer(state, levelId, timer) {
  state.timers = state.timers.map((item) => item.levelId === levelId ? timer : item);
}

export function finishTimers(state, now = Date.now()) {
  let changed = false;
  const timers = state.timers.map((timer) => {
    if (timer.status !== "RUNNING" || remainingTime(timer, now) > 0) return timer;
    changed = true;
    return { ...timer, status: "FINISHED", remainingMs: 0, startedAt: null };
  });
  if (!changed) return state;
  return {
    ...state,
    timers,
    revision: state.revision + 1,
    updatedAt: now
  };
}

export function publicState(state, now = Date.now()) {
  const timers = state.timers.map((timer) => {
    if (timer.status !== "RUNNING" || remainingTime(timer, now) > 0) return { ...timer };
    return { ...timer, status: "FINISHED", remainingMs: 0, startedAt: null };
  });
  return { ...state, timers, serverNow: now };
}
