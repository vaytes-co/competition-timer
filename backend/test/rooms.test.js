import test from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/rooms.js";

test("rooms hash passwords, authorize the owner Controller, and permit Displays", async () => {
  const manager = new RoomManager({ now: () => 1_000 });
  const created = await manager.create({ name: "Final Round", password: "pass1234" }, "controller");
  const room = manager.rooms.get(created.room.code);
  assert.notEqual(room.passwordHash, "pass1234");
  assert.equal(room.code.length, 6);
  assert.match(room.code, /^[A-HJ-NP-Z2-9]+$/);

  await assert.rejects(manager.join({
    code: room.code,
    password: "wrongpass",
    role: "DISPLAY"
  }, "bad-display"), /incorrect/);
  await assert.rejects(manager.join({
    code: room.code,
    password: "pass1234",
    role: "CONTROLLER",
    sessionToken: "not-the-token"
  }, "intruder"), /primary Controller/);

  const joined = await manager.join({ code: room.code, password: "pass1234", role: "DISPLAY" }, "display");
  assert.equal(joined.room.members.displaysOnline, 1);
  assert.throws(() => manager.command("display", { type: "set-view", view: "BACKDROP" }), /Only/);
  assert.throws(() => manager.command("display", { type: "retry-video" }), /Only/);
  manager.leave("display");
  assert.equal(manager.snapshot(room).members.displaysOnline, 0);
});

test("owner reconnect requires the session token and closed/expired rooms are unavailable", async () => {
  let now = 5_000;
  const manager = new RoomManager({ ttlMs: 1_000, now: () => now });
  const created = await manager.create({ name: "Practice", password: "pass123" }, "first");
  manager.leave("first");
  await manager.join({
    code: created.room.code,
    password: "pass123",
    role: "CONTROLLER",
    sessionToken: created.sessionToken
  }, "reconnected");
  assert.equal(manager.getMember("reconnected").role, "CONTROLLER");
  now += 1_001;
  assert.equal(manager.getMember("reconnected"), null);
  assert.equal(manager.list().length, 0);
});

test("a password-holder can replace the primary Controller only after it disconnects", async () => {
  const manager = new RoomManager();
  const created = await manager.create({ name: "Controller swap", password: "pass123" }, "first");
  await assert.rejects(manager.join({
    code: created.room.code,
    password: "pass123",
    role: "CONTROLLER"
  }, "intruder"), /primary Controller/);

  manager.leave("first");
  const replacement = await manager.join({
    code: created.room.code,
    password: "pass123",
    role: "CONTROLLER"
  }, "replacement");
  assert.ok(replacement.sessionToken);
  assert.notEqual(replacement.sessionToken, created.sessionToken);
  assert.equal(manager.getMember("replacement").role, "CONTROLLER");
});

test("the primary Controller can reveal three database winners without changing timer settings", async () => {
  const manager = new RoomManager({ now: () => 10_000 });
  const created = await manager.create({ name: "Winner reveal", password: "pass1234" }, "controller");
  manager.command("controller", { type: "select-level", levelId: "fwm" });
  manager.command("controller", { type: "start", levelId: "fwm" });
  const before = manager.snapshot(manager.rooms.get(created.room.code)).state.timers;
  const result = {
    levelId: "fwm",
    levelName: "Fun With Machine",
    winners: [
      { place: 1, name: "First Place", score: 125, durationMs: 42_500 },
      { place: 2, name: "Second Place", score: 115, durationMs: 44_000 },
      { place: 3, name: "Third Place", score: 105, durationMs: 47_000 }
    ]
  };

  const revealed = manager.revealWinners("controller", result);
  assert.equal(revealed.state.activeView, "WINNER");
  assert.deepEqual(revealed.state.winnerReveal, result);
  assert.deepEqual(revealed.state.timers, before);
  assert.throws(() => manager.revealWinners("controller", null), /no scored winners/);
});

test("Displays cannot trigger winner reveals and normal display commands dismiss them", async () => {
  const manager = new RoomManager();
  const created = await manager.create({ name: "Winner permissions", password: "pass1234" }, "controller");
  await manager.join({ code: created.room.code, password: "pass1234", role: "DISPLAY" }, "display");
  const result = {
    levelId: "fwp",
    levelName: "Fun With Programming",
    winners: [{ place: 1, name: "First Place", score: 100, durationMs: 1000 }]
  };
  assert.throws(() => manager.revealWinners("display", result), /primary Controller/);

  manager.revealWinners("controller", result);
  const restored = manager.command("controller", { type: "set-view", view: "BACKDROP" });
  assert.equal(restored.state.activeView, "BACKDROP");
  assert.equal(restored.state.winnerReveal, null);
});
