import test from "node:test";
import assert from "node:assert/strict";
import {
  bestAttempt, createScoringMediaName, parseByteRange, rankAllParticipants, rankParticipants,
  runScoringMigrations, summarizeScoringResults, validateScoringPassword
} from "../src/scoring.js";

test("uploaded media names use the participant name and independent photo/video sequence", () => {
  assert.equal(createScoringMediaName(" Ádám Example ", "image/jpeg", 2), "ádám_example_photo-2.jpg");
  assert.equal(createScoringMediaName("Participant", "video/quicktime", 1), "participant_video-1.mov");
  assert.equal(createScoringMediaName("!!!", "image/png", 1), "participant_photo-1.png");
  assert.throws(() => createScoringMediaName("Participant", "image/gif", 1), /supported media type/);
});

test("best attempt prioritizes score, then the fastest time", () => {
  assert.deepEqual(bestAttempt([
    { attemptNumber: 1, score: 90, durationMs: 40_000 },
    { attemptNumber: 2, score: 100, durationMs: 60_000 },
    { attemptNumber: 3, score: 100, durationMs: 50_000 }
  ]), { attemptNumber: 3, score: 100, durationMs: 50_000 });
});

test("podium orders score, time, and then younger birth date, returning at most three", () => {
  const participants = [
    { id: "older", name: "Older", birthDate: "2013-01-01", attempts: [{ score: 100, durationMs: 30_000 }] },
    { id: "fast", name: "Fast", birthDate: "2014-01-01", attempts: [{ score: 100, durationMs: 25_000 }] },
    { id: "young", name: "Young", birthDate: "2016-02-01", attempts: [{ score: 100, durationMs: 30_000 }] },
    { id: "fourth", name: "Fourth", birthDate: "2015-01-01", attempts: [{ score: 90, durationMs: 20_000 }] },
    { id: "unscored", name: "Unscored", birthDate: "2017-01-01", attempts: [] }
  ];
  assert.deepEqual(rankParticipants(participants).map(({ id, place }) => ({ id, place })), [
    { id: "fast", place: 1 },
    { id: "young", place: 2 },
    { id: "older", place: 3 }
  ]);
});

test("full rankings include every participant and place unscored entries last", () => {
  const ranked = rankAllParticipants([
    { id: "unscored", name: "Unscored", birthDate: "2016-01-01", attempts: [] },
    { id: "winner", name: "Winner", birthDate: "2015-01-01", attempts: [{ score: 50, durationMs: 2000 }] }
  ]);
  assert.deepEqual(ranked.map(({ id, place }) => ({ id, place })), [
    { id: "winner", place: 1 },
    { id: "unscored", place: null }
  ]);
});

test("results summary groups participants by level and includes unscored entries", () => {
  const levels = summarizeScoringResults([
    { id: 2, level_id: "mosaic-1d", name: "Second", birthDate: "2015-01-01", attempt_number: 1, score: "10.5", duration_ms: 5000 },
    { id: 1, level_id: "mosaic-1d", name: "First", birthDate: "2016-01-01", attempt_number: 1, score: "10.5", duration_ms: 5000 },
    { id: 3, level_id: "mosaic-1d", name: "No score", birthDate: "2017-01-01", attempt_number: null, score: null, duration_ms: null }
  ]);
  const mosaic = levels.find((level) => level.id === "mosaic-1d");
  assert.deepEqual(mosaic.participants.map(({ name, place, bestAttempt }) => ({
    name,
    place,
    score: bestAttempt?.score ?? null
  })), [
    { name: "First", place: 1, score: 10.5 },
    { name: "Second", place: 2, score: 10.5 },
    { name: "No score", place: null, score: null }
  ]);
  assert.equal(levels.length, 7);
});

test("scoring passwords accept four characters and enforce bcrypt's byte limit", () => {
  assert.equal(validateScoringPassword("abcd"), undefined);
  assert.equal(validateScoringPassword("😀😀😀😀"), undefined);
  assert.throws(() => validateScoringPassword("abc"), /4 characters/);
  assert.throws(() => validateScoringPassword("a".repeat(73)), /72 UTF-8 bytes/);
});

test("video byte ranges support normal and suffix requests and reject invalid ranges", () => {
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange("bytes=95-", 100), { start: 95, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-12", 100), { start: 88, end: 99 });
  assert.equal(parseByteRange("bytes=100-", 100), undefined);
  assert.equal(parseByteRange("bytes=0-1,4-5", 100), undefined);
  assert.equal(parseByteRange(undefined, 100), null);
});

test("schema migration creates all scoring tables once and records its version", async () => {
  const statements = [];
  let migrationApplied = false;
  const pool = {
    async query(statement) {
      statements.push(statement);
      if (statement.includes("SELECT version FROM scoring_schema_migrations")) {
        return [migrationApplied ? [{ version: 1 }] : []];
      }
      return [{}];
    },
    async execute(statement, values) {
      statements.push(statement);
      assert.deepEqual(values, [1, "initial scoring schema"]);
      migrationApplied = true;
      return [{}];
    }
  };

  assert.deepEqual(await runScoringMigrations(pool), [1]);
  assert.equal(statements.filter((statement) => statement.includes("CREATE TABLE IF NOT EXISTS scoring_")).length, 7);
  assert.deepEqual(await runScoringMigrations(pool), []);
  assert.equal(statements.filter((statement) => statement.includes("CREATE TABLE IF NOT EXISTS scoring_")).length, 8);
});
