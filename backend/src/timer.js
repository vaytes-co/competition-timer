export const LEVELS = Object.freeze([
  { id: "mosaic", name: "Mosaic", subtitle: "Mosaic", durationMs: 20 * 60_000 },
  { id: "fwm", name: "FWM", subtitle: "Fun With Machine", durationMs: 20 * 60_000 },
  { id: "fwp", name: "FWP", subtitle: "Fun With Programming", durationMs: 60 * 60_000 },
  { id: "mechanic-engineering", name: "Mechanic Engineering", subtitle: "Mechanic Engineering", durationMs: 60 * 60_000 },
  { id: "programming", name: "Programming", subtitle: "Programming", durationMs: 120 * 60_000 }
]);

export class TimerCommandError extends Error {}

function rejectCommand(message) {
  throw new TimerCommandError(message);
}

export function remainingTime(timer, now = Date.now()) {
  if (timer.status !== "RUNNING" || timer.startedAt === null) return timer.remainingMs;
  return Math.max(0, timer.remainingMs - Math.max(0, now - timer.startedAt));
}

export function createInitialState(now = Date.now()) {
  return {
    activeView: "BACKDROP",
    activeLevel: null,
    timer: { status: "READY", durationMs: 0, remainingMs: 0, startedAt: null },
    audio: { muted: false, volume: 0.35 },
    revision: 1,
    updatedAt: now
  };
}

export function applyCommand(state, command, now = Date.now()) {
  const next = structuredClone(state);
  const currentRemaining = remainingTime(state.timer, now);

  switch (command.type) {
    case "select-level": {
      const level = LEVELS.find((item) => item.id === command.levelId);
      if (!level) rejectCommand("Unknown competition level.");
      if (["RUNNING", "PAUSED"].includes(state.timer.status) && !command.confirm) {
        rejectCommand("Confirm replacing the active timer before switching levels.");
      }
      next.activeLevel = level.id;
      next.activeView = "TIMER";
      next.timer = {
        status: "READY",
        durationMs: level.durationMs,
        remainingMs: level.durationMs,
        startedAt: null
      };
      break;
    }
    case "set-view":
      if (!["BACKDROP", "TIMER"].includes(command.view)) rejectCommand("Invalid display view.");
      if (command.view === "TIMER" && !state.activeLevel) rejectCommand("Select a level before showing the timer.");
      next.activeView = command.view;
      break;
    case "start":
      if (state.timer.status !== "READY" || !state.activeLevel) rejectCommand("The timer is not ready to start.");
      next.timer = { ...state.timer, status: "RUNNING", startedAt: now };
      break;
    case "pause":
      if (state.timer.status !== "RUNNING") rejectCommand("Only a running timer can be paused.");
      next.timer = { ...state.timer, status: "PAUSED", remainingMs: currentRemaining, startedAt: null };
      break;
    case "resume":
      if (state.timer.status !== "PAUSED" || currentRemaining <= 0) rejectCommand("The timer cannot be resumed.");
      next.timer = { ...state.timer, status: "RUNNING", remainingMs: currentRemaining, startedAt: now };
      break;
    case "reset":
      if (!state.activeLevel) rejectCommand("Select a level before resetting the timer.");
      next.timer = {
        status: "READY",
        durationMs: state.timer.durationMs,
        remainingMs: state.timer.durationMs,
        startedAt: null
      };
      break;
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

export function finishTimer(state, now = Date.now()) {
  if (state.timer.status !== "RUNNING" || remainingTime(state.timer, now) > 0) return state;
  return {
    ...state,
    timer: { ...state.timer, status: "FINISHED", remainingMs: 0, startedAt: null },
    revision: state.revision + 1,
    updatedAt: now
  };
}

export function publicState(state, now = Date.now()) {
  const timer = { ...state.timer };
  if (timer.status === "RUNNING" && remainingTime(timer, now) === 0) {
    timer.status = "FINISHED";
    timer.remainingMs = 0;
    timer.startedAt = null;
  }
  return { ...state, timer, serverNow: now };
}
