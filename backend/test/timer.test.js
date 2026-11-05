import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createInitialState, finishTimer, LEVELS, publicState, remainingTime } from "../src/timer.js";

test("defines all five levels with the required default durations", () => {
  assert.deepEqual(LEVELS.map(({ id, durationMs }) => [id, durationMs / 60_000]), [
    ["mosaic", 20],
    ["fwm", 20],
    ["fwp", 60],
    ["mechanic-engineering", 60],
    ["programming", 120]
  ]);
});

test("server timestamps determine remaining time and pause preserves it", () => {
  const selected = applyCommand(createInitialState(0), { type: "select-level", levelId: "mosaic" }, 0);
  const started = applyCommand(selected, { type: "start" }, 10_000);
  assert.equal(remainingTime(started.timer, 25_000), 1_185_000);
  const paused = applyCommand(started, { type: "pause" }, 25_000);
  assert.equal(paused.timer.remainingMs, 1_185_000);
  assert.equal(paused.timer.status, "PAUSED");
});

test("resume, reset, and finish retain consistent timer states", () => {
  let state = applyCommand(createInitialState(0), { type: "select-level", levelId: "fwm" }, 0);
  state = applyCommand(state, { type: "start" }, 1_000);
  state = applyCommand(state, { type: "pause" }, 11_000);
  state = applyCommand(state, { type: "resume" }, 20_000);
  assert.equal(remainingTime(state.timer, 25_000), 1_185_000);
  state = finishTimer(state, 20_000 + 1_190_000);
  assert.equal(state.timer.status, "FINISHED");
  assert.equal(state.timer.remainingMs, 0);
  state = applyCommand(state, { type: "reset" }, 1_300_000);
  assert.equal(state.timer.status, "READY");
  assert.equal(state.timer.remainingMs, 1_200_000);
});

test("rejects invalid transitions, levels, and stale level replacement", () => {
  const initial = createInitialState(0);
  assert.throws(() => applyCommand(initial, { type: "pause" }, 0), /Only a running timer/);
  assert.throws(() => applyCommand(initial, { type: "select-level", levelId: "other" }, 0), /Unknown/);
  let state = applyCommand(initial, { type: "select-level", levelId: "programming" }, 0);
  state = applyCommand(state, { type: "start" }, 10);
  assert.throws(() => applyCommand(state, { type: "select-level", levelId: "mosaic" }, 20), /Confirm/);
});

test("public snapshots interpolate running timers and mark elapsed timers finished", () => {
  let state = applyCommand(createInitialState(0), { type: "select-level", levelId: "mosaic" }, 0);
  state = applyCommand(state, { type: "start" }, 1_000);
  const runningSnapshot = publicState(state, 11_000);
  assert.equal(runningSnapshot.timer.remainingMs, 1_200_000);
  assert.equal(remainingTime(runningSnapshot.timer, runningSnapshot.serverNow), 1_190_000);
  const elapsed = publicState(state, 1_201_000);
  assert.equal(elapsed.timer.remainingMs, 0);
  assert.equal(elapsed.timer.status, "FINISHED");
});
