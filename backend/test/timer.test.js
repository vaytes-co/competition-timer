import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createInitialState, DISPLAY_VIDEO_IDS, finishTimers, LEVELS, publicState, remainingTime } from "../src/timer.js";

test("defines all six levels with the required names and durations", () => {
  assert.deepEqual(LEVELS.map(({ id, name, subtitle, durationMs }) => [id, name, subtitle, durationMs / 60_000]), [
    ["mosaic-1d-2d", "Mosaic 1D & 2D", "Building", 20],
    ["mosaic-3d", "Mosaic 3D", "Building", 40],
    ["fwm", "Fun With Machine", "Building", 20],
    ["fwp", "Fun With Programming", "Building and test track", 60],
    ["mechanic-engineering", "Mechanic Engineering", "Building and test track", 60],
    ["programming", "Programming", "Building and test track", 120]
  ]);
});

test("runs and pauses two level timers independently", () => {
  let state = createInitialState(0);
  state = applyCommand(state, { type: "select-level", levelId: "mosaic-3d" }, 0);
  state = applyCommand(state, { type: "select-level", levelId: "fwm" }, 0);
  state = applyCommand(state, { type: "start", levelId: "mosaic-3d" }, 10_000);
  state = applyCommand(state, { type: "start", levelId: "fwm" }, 10_000);
  state = applyCommand(state, { type: "pause", levelId: "fwm" }, 25_000);
  assert.equal(remainingTime(state.timers.find(({ levelId }) => levelId === "mosaic-3d"), 25_000), 2_385_000);
  assert.equal(state.timers.find(({ levelId }) => levelId === "fwm").remainingMs, 1_185_000);
  assert.equal(state.timers.find(({ levelId }) => levelId === "fwm").status, "PAUSED");
  assert.equal(state.timers.find(({ levelId }) => levelId === "mosaic-3d").status, "RUNNING");
});

test("resets and finishes timers individually, and reset makes a finished timer available again", () => {
  let state = applyCommand(createInitialState(0), { type: "select-level", levelId: "fwm" }, 0);
  state = applyCommand(state, { type: "select-level", levelId: "mosaic-3d" }, 0);
  state = applyCommand(state, { type: "start", levelId: "fwm" }, 1_000);
  state = applyCommand(state, { type: "start", levelId: "mosaic-3d" }, 1_000);
  state = finishTimers(state, 1_201_000);
  assert.equal(state.timers.find(({ levelId }) => levelId === "fwm").status, "FINISHED");
  assert.equal(state.timers.find(({ levelId }) => levelId === "fwm").remainingMs, 0);
  assert.equal(state.timers.find(({ levelId }) => levelId === "mosaic-3d").status, "RUNNING");
  state = applyCommand(state, { type: "reset", levelId: "fwm" }, 1_202_000);
  assert.equal(state.timers.find(({ levelId }) => levelId === "fwm").status, "READY");
  assert.equal(state.timers.find(({ levelId }) => levelId === "fwm").remainingMs, 1_200_000);
});

test("rejects invalid timer transitions, duplicate selection, and a third selected level", () => {
  let state = createInitialState(0);
  assert.throws(() => applyCommand(state, { type: "pause", levelId: "fwm" }, 0), /Select a level/);
  assert.throws(() => applyCommand(state, { type: "select-level", levelId: "other" }, 0), /Unknown/);
  state = applyCommand(state, { type: "select-level", levelId: "mosaic-1d-2d" }, 0);
  assert.throws(() => applyCommand(state, { type: "select-level", levelId: "mosaic-1d-2d" }, 0), /already selected/);
  state = applyCommand(state, { type: "select-level", levelId: "mosaic-3d" }, 0);
  assert.throws(() => applyCommand(state, { type: "select-level", levelId: "fwm" }, 0), /Only two/);
  state = applyCommand(state, { type: "start", levelId: "mosaic-1d-2d" }, 10);
  assert.throws(() => applyCommand(state, { type: "remove-level", levelId: "mosaic-1d-2d" }, 20), /Confirm/);
});

test("selecting a display video changes the view without changing timers", () => {
  const initial = createInitialState(0);
  const selected = applyCommand(initial, { type: "set-video", videoId: "break" }, 1);
  assert.equal(selected.activeView, "VIDEO");
  assert.equal(selected.activeVideo, "break");
  assert.deepEqual(selected.timers, initial.timers);
  assert.throws(() => applyCommand(initial, { type: "set-video", videoId: "missing" }, 2), /Unknown display video/);
  assert.ok(DISPLAY_VIDEO_IDS.includes("mosaic-&-fwm-grading"));
});

test("retrying a display video increments the synchronized retry revision", () => {
  const initial = createInitialState(0);
  const retried = applyCommand(initial, { type: "retry-video" }, 1);
  assert.equal(retried.displayVideoRetry, initial.displayVideoRetry + 1);
  assert.equal(retried.updatedAt, 1);
  assert.equal(retried.revision, initial.revision + 1);
});

test("public snapshots interpolate timers and mark each elapsed timer finished", () => {
  let state = applyCommand(createInitialState(0), { type: "select-level", levelId: "mosaic-1d-2d" }, 0);
  state = applyCommand(state, { type: "select-level", levelId: "mosaic-3d" }, 0);
  state = applyCommand(state, { type: "start", levelId: "mosaic-1d-2d" }, 1_000);
  state = applyCommand(state, { type: "start", levelId: "mosaic-3d" }, 1_000);
  const runningSnapshot = publicState(state, 11_000);
  assert.equal(runningSnapshot.timers[0].remainingMs, 1_200_000);
  assert.equal(remainingTime(runningSnapshot.timers[0], runningSnapshot.serverNow), 1_190_000);
  const elapsed = publicState(state, 1_201_000);
  assert.equal(elapsed.timers[0].remainingMs, 0);
  assert.equal(elapsed.timers[0].status, "FINISHED");
  assert.equal(elapsed.timers[1].status, "RUNNING");
});

test("removing the last timer returns the display to the backdrop", () => {
  let state = applyCommand(createInitialState(0), { type: "select-level", levelId: "fwm" }, 0);
  state = applyCommand(state, { type: "remove-level", levelId: "fwm" }, 1);
  assert.equal(state.activeView, "BACKDROP");
  assert.deepEqual(state.timers, []);
});
