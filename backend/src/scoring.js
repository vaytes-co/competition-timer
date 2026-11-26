import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import express from "express";
import multer from "multer";
import mysql from "mysql2/promise";

export const SCORING_LEVELS = Object.freeze([
  { id: "mosaic-1d", name: "Mosaic 1D", attempts: 1 },
  { id: "mosaic-2d", name: "Mosaic 2D", attempts: 1 },
  { id: "mosaic-3d", name: "Mosaic 3D", attempts: 1 },
  { id: "fwm", name: "Fun With Machine", attempts: 1 },
  { id: "fwp", name: "Fun With Programming", attempts: 3 },
  { id: "mechanic-engineering", name: "Mechanic Engineering", attempts: 3 },
  { id: "programming", name: "Programming", attempts: 2 }
]);

const LEVEL_BY_ID = new Map(SCORING_LEVELS.map((level) => [level.id, level]));
const SESSION_DAYS = 365;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_TIME_MS = 7 * 24 * 60 * 60 * 1000;
const MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/quicktime", ".mov"]
]);

export function createScoringMediaName(participantName, mimeType, sequence) {
  const extension = MIME_EXTENSIONS.get(mimeType);
  if (!extension || !Number.isInteger(sequence) || sequence < 1) {
    throw new Error("A supported media type and positive sequence number are required.");
  }
  const safeParticipantName = participantName
    .normalize("NFKC")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 180)
    .replace(/_+$/g, "") || "participant";
  const mediaType = mimeType.startsWith("video/") ? "video" : "photo";
  return `${safeParticipantName}_${mediaType}-${sequence}${extension}`;
}

export function bestAttempt(attempts) {
  return attempts.reduce((best, attempt) => {
    if (!best || Number(attempt.score) > Number(best.score) ||
      (Number(attempt.score) === Number(best.score) && attempt.durationMs < best.durationMs)) return attempt;
    return best;
  }, null);
}

export function rankParticipants(participants) {
  return rankAllParticipants(participants)
    .filter((participant) => participant.bestAttempt)
    .slice(0, 3);
}

export function rankAllParticipants(participants) {
  const ranked = participants
    .map((participant) => ({ ...participant, bestAttempt: bestAttempt(participant.attempts) }))
    .sort((left, right) => {
      if (!left.bestAttempt || !right.bestAttempt) {
        if (left.bestAttempt) return -1;
        if (right.bestAttempt) return 1;
        return left.name.localeCompare(right.name);
      }
      return Number(right.bestAttempt.score) - Number(left.bestAttempt.score) ||
        left.bestAttempt.durationMs - right.bestAttempt.durationMs ||
        right.birthDate.localeCompare(left.birthDate) ||
        left.name.localeCompare(right.name);
    });
  let place = 0;
  return ranked.map((participant) => ({
    ...participant,
    place: participant.bestAttempt ? ++place : null
  }));
}

export function summarizeScoringResults(rows) {
  const participantsByLevel = new Map(SCORING_LEVELS.map((level) => [level.id, new Map()]));
  for (const row of rows) {
    const byId = participantsByLevel.get(row.level_id);
    if (!byId) continue;
    const id = String(row.id);
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: row.name,
        birthDate: row.birthDate,
        attempts: []
      });
    }
    if (row.attempt_number !== null) {
      byId.get(id).attempts.push({
        attemptNumber: Number(row.attempt_number),
        score: Number(row.score),
        durationMs: Number(row.duration_ms)
      });
    }
  }
  return SCORING_LEVELS.map((level) => ({
    ...level,
    participants: rankAllParticipants([...participantsByLevel.get(level.id).values()])
  }));
}

export function parseByteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return undefined;
  const suffixLength = Number(match[2]);
  if (!match[1] && suffixLength <= 0) return undefined;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - suffixLength);
  const end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return undefined;
  return { start, end: Math.min(end, size - 1) };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireJudge(request, response, next) {
  if (request.user.role !== "juri") {
    response.status(403).json({ error: "Only a judge can record or edit scores." });
    return;
  }
  next();
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value &&
    value < new Date().toISOString().slice(0, 10);
}

function validateLevel(levelId) {
  const level = LEVEL_BY_ID.get(levelId);
  if (!level) throw validationError("Choose a valid competition level.");
  return level;
}

export function validateScoringPassword(password) {
  const passwordCharacters = typeof password === "string" ? [...password].length : 0;
  const passwordBytes = typeof password === "string" ? Buffer.byteLength(password, "utf8") : 0;
  if (passwordCharacters < 4 || passwordBytes > 72) {
    throw new Error("Password must contain at least 4 characters and no more than 72 UTF-8 bytes.");
  }
}

const INITIAL_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS scoring_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      password_hash VARCHAR(100) NOT NULL,
      role ENUM('asisten', 'juri') NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `,
  `
    CREATE TABLE IF NOT EXISTS scoring_sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      expires_at_ms BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX scoring_sessions_expiry (expires_at_ms),
      CONSTRAINT scoring_sessions_user FOREIGN KEY (user_id) REFERENCES scoring_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `,
  `
    CREATE TABLE IF NOT EXISTS scoring_participants (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      level_id VARCHAR(40) NOT NULL,
      name VARCHAR(100) NOT NULL,
      birth_date DATE NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX scoring_participants_level (level_id, name)
    ) ENGINE=InnoDB
  `,
  `
    CREATE TABLE IF NOT EXISTS scoring_attempts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      participant_id BIGINT UNSIGNED NOT NULL,
      attempt_number TINYINT UNSIGNED NOT NULL,
      score DECIMAL(10, 2) NOT NULL,
      duration_ms INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY scoring_attempt_unique (participant_id, attempt_number),
      CONSTRAINT scoring_attempt_participant FOREIGN KEY (participant_id)
        REFERENCES scoring_participants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `,
  `
    CREATE TABLE IF NOT EXISTS scoring_media (
      id CHAR(36) NOT NULL PRIMARY KEY,
      participant_id BIGINT UNSIGNED NOT NULL,
      file_name VARCHAR(80) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(80) NOT NULL,
      file_size INT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX scoring_media_participant (participant_id, created_at),
      CONSTRAINT scoring_media_participant FOREIGN KEY (participant_id)
        REFERENCES scoring_participants(id) ON DELETE CASCADE,
      CONSTRAINT scoring_media_user FOREIGN KEY (created_by)
        REFERENCES scoring_users(id)
    ) ENGINE=InnoDB
  `,
  `
    CREATE TABLE IF NOT EXISTS scoring_media_tickets (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      media_id CHAR(36) NOT NULL,
      expires_at_ms BIGINT UNSIGNED NOT NULL,
      INDEX scoring_media_ticket_expiry (expires_at_ms),
      CONSTRAINT scoring_media_ticket_file FOREIGN KEY (media_id)
        REFERENCES scoring_media(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `
];

const SCORING_MIGRATIONS = [
  {
    version: 1,
    name: "initial scoring schema",
    async apply(pool) {
      for (const statement of INITIAL_SCHEMA_STATEMENTS) await pool.query(statement);
    }
  }
];

export async function runScoringMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scoring_schema_migrations (
      version INT UNSIGNED NOT NULL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  const [applied] = await pool.query(
    "SELECT version FROM scoring_schema_migrations"
  );
  const appliedVersions = new Set(applied.map((row) => Number(row.version)));
  const newlyApplied = [];
  for (const migration of SCORING_MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    await migration.apply(pool);
    await pool.execute(
      "INSERT IGNORE INTO scoring_schema_migrations (version, name) VALUES (?, ?)",
      [migration.version, migration.name]
    );
    newlyApplied.push(migration.version);
  }
  return newlyApplied;
}

export async function runFreshScoringMigrations(pool) {
  const tables = [
    "scoring_media_tickets",
    "scoring_attempts",
    "scoring_media",
    "scoring_sessions",
    "scoring_participants",
    "scoring_users",
    "scoring_schema_migrations"
  ];
  for (const table of tables) await pool.query(`DROP TABLE IF EXISTS \`${table}\``);
  return runScoringMigrations(pool);
}

export function createScoringPool({
  mysqlUrl = process.env.MYSQL_URL,
  host = process.env.MYSQL_HOST || "127.0.0.1",
  port = Number(process.env.MYSQL_PORT || 3306),
  user = process.env.MYSQL_USER || "root",
  password = process.env.MYSQL_PASSWORD || "",
  database = process.env.MYSQL_DATABASE || "competition_timer"
} = {}) {
  if (mysqlUrl) return mysql.createPool(mysqlUrl);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MYSQL_PORT must be an integer between 1 and 65535.");
  }
  if (typeof database !== "string" || !database.trim()) {
    throw new Error("MYSQL_DATABASE must contain a database name.");
  }
  return mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4"
  });
}

function participantShape(row, attempts) {
  return {
    id: String(row.id),
    levelId: row.level_id,
    name: row.name,
    birthDate: row.birthDate,
    attempts: attempts.map((attempt) => ({
      attemptNumber: Number(attempt.attempt_number),
      score: Number(attempt.score),
      durationMs: Number(attempt.duration_ms)
    }))
  };
}

export function createScoringRouter({
  mediaDirectory = process.env.SCORING_MEDIA_DIR ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "storage", "scoring-media")
} = {}) {
  const router = express.Router();
  let pool = null;
  let configurationError = null;
  try {
    pool = createScoringPool();
  } catch (error) {
    configurationError = error;
  }
  let ready = false;

  const initialize = async () => {
    if (configurationError) throw configurationError;
    if (!pool) return false;
    await mkdir(mediaDirectory, { recursive: true });
    await runScoringMigrations(pool);
    ready = true;
    return true;
  };

  const database = (request, response, next) => {
    if (!pool || !ready) {
      response.status(503).json({ error: "Scoring is unavailable until MySQL is configured and ready." });
      return;
    }
    next();
  };

  router.get("/status", (_request, response) => {
    response.json({ enabled: Boolean(pool), ready });
  });

  router.get("/media/:mediaId/stream", database, asyncRoute(async (request, response, next) => {
    const ticket = typeof request.query.ticket === "string" ? request.query.ticket : "";
    if (!ticket || ticket.length > 128) throw validationError("A valid media access ticket is required.", 401);
    const [rows] = await pool.execute(
      `SELECT m.file_name, m.original_name, m.mime_type
       FROM scoring_media_tickets t JOIN scoring_media m ON m.id = t.media_id
       WHERE t.token_hash = ? AND t.media_id = ? AND t.expires_at_ms > ? LIMIT 1`,
      [hashToken(ticket), request.params.mediaId, Date.now()]
    );
    if (!rows.length) throw validationError("This media access ticket has expired.", 401);
    const filePath = path.join(mediaDirectory, path.basename(rows[0].file_name));
    let fileInfo;
    try {
      fileInfo = await stat(filePath);
    } catch (error) {
      if (error.code === "ENOENT") throw validationError("Media file is unavailable.", 404);
      throw error;
    }
    const range = parseByteRange(request.get("range"), fileInfo.size);
    if (range === undefined) {
      response.status(416).set("Content-Range", `bytes */${fileInfo.size}`).end();
      return;
    }
    response.set({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=300",
      "Content-Type": rows[0].mime_type,
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff"
    });
    if (request.query.download === "1") {
      response.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].original_name)}`);
    }
    const streamFile = (options) => {
      const stream = createReadStream(filePath, options);
      stream.on("error", (error) => {
        if (response.headersSent) {
          console.error("Scoring media stream failed:", error);
          response.destroy();
        } else {
          next(error);
        }
      });
      stream.pipe(response);
    };
    if (!range) {
      response.set("Content-Length", String(fileInfo.size));
      streamFile();
      return;
    }
    response.status(206).set({
      "Content-Length": String(range.end - range.start + 1),
      "Content-Range": `bytes ${range.start}-${range.end}/${fileInfo.size}`
    });
    streamFile(range);
  }));

  router.post("/auth/login", database, asyncRoute(async (request, response) => {
    const { username, password } = request.body || {};
    if (typeof username !== "string" || typeof password !== "string" || username.length > 80 ||
      Buffer.byteLength(password, "utf8") > 72) {
      throw validationError("Enter your username and password.");
    }
    const [rows] = await pool.execute(
      "SELECT id, username, password_hash, role FROM scoring_users WHERE username = ? AND active = TRUE LIMIT 1",
      [username.trim()]
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      throw validationError("Username or password is incorrect.", 401);
    }
    await pool.execute("DELETE FROM scoring_sessions WHERE expires_at_ms <= ?", [Date.now()]);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    await pool.execute(
      "INSERT INTO scoring_sessions (token_hash, user_id, expires_at_ms) VALUES (?, ?, ?)",
      [hashToken(token), rows[0].id, expiresAt]
    );
    response.json({ token, expiresAt, user: { username: rows[0].username, role: rows[0].role } });
  }));

  router.use(database);
  router.use(asyncRoute(async (request, response, next) => {
    const authorization = request.get("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token || token.length > 128) throw validationError("Sign in to continue.", 401);
    const tokenHash = hashToken(token);
    const [rows] = await pool.execute(
      `SELECT u.id, u.username, u.role, s.expires_at_ms
       FROM scoring_sessions s JOIN scoring_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at_ms > ? AND u.active = TRUE LIMIT 1`,
      [tokenHash, Date.now()]
    );
    if (!rows.length) throw validationError("Your scoring session has expired. Please sign in again.", 401);
    if (Number(rows[0].expires_at_ms) - Date.now() < (SESSION_DAYS - 30) * 24 * 60 * 60 * 1000) {
      await pool.execute(
        "UPDATE scoring_sessions SET expires_at_ms = ? WHERE token_hash = ?",
        [Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000, tokenHash]
      );
    }
    request.user = { id: String(rows[0].id), username: rows[0].username, role: rows[0].role, tokenHash };
    next();
  }));

  router.get("/auth/me", (request, response) => {
    response.json({ user: { username: request.user.username, role: request.user.role } });
  });

  router.post("/auth/logout", asyncRoute(async (request, response) => {
    await pool.execute("DELETE FROM scoring_sessions WHERE token_hash = ?", [request.user.tokenHash]);
    response.json({ ok: true });
  }));

  router.get("/levels", (_request, response) => response.json({ levels: SCORING_LEVELS }));

  router.get("/results", requireJudge, asyncRoute(async (_request, response) => {
    const [rows] = await pool.query(`
      SELECT p.id, p.level_id, p.name,
        DATE_FORMAT(p.birth_date, '%Y-%m-%d') AS birthDate,
        a.attempt_number, a.score, a.duration_ms
      FROM scoring_participants p
      LEFT JOIN scoring_attempts a ON a.participant_id = p.id
      ORDER BY p.level_id, p.name, a.attempt_number
    `);
    response.json({ levels: summarizeScoringResults(rows) });
  }));

  router.get("/participants", asyncRoute(async (request, response) => {
    const level = validateLevel(request.query.levelId);
    const [rows] = await pool.execute(
      `SELECT id, level_id, name, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate
       FROM scoring_participants WHERE level_id = ? ORDER BY name`,
      [level.id]
    );
    const ids = request.user.role === "juri" ? rows.map((row) => row.id) : [];
    const attemptsByParticipant = new Map(ids.map((id) => [String(id), []]));
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const [attemptRows] = await pool.execute(
        `SELECT participant_id, attempt_number, score, duration_ms
         FROM scoring_attempts WHERE participant_id IN (${placeholders}) ORDER BY attempt_number`,
        ids
      );
      for (const attempt of attemptRows) attemptsByParticipant.get(String(attempt.participant_id)).push(attempt);
    }
    const participants = rows.map((row) => participantShape(row, attemptsByParticipant.get(String(row.id)) || []));
    response.json({
      participants,
      winners: request.user.role === "juri" ? rankParticipants(participants) : [],
      maxAttempts: request.user.role === "juri" ? level.attempts : 0
    });
  }));

  router.post("/participants", requireJudge, asyncRoute(async (request, response) => {
    const { levelId, name, birthDate } = request.body || {};
    validateLevel(levelId);
    if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
      throw validationError("Participant name must be between 1 and 100 characters.");
    }
    if (!validDate(birthDate)) throw validationError("Enter a valid birth date in the past.");
    const [result] = await pool.execute(
      "INSERT INTO scoring_participants (level_id, name, birth_date) VALUES (?, ?, ?)",
      [levelId, name.trim(), birthDate]
    );
    response.status(201).json({
      participant: { id: String(result.insertId), levelId, name: name.trim(), birthDate, attempts: [] }
    });
  }));

  router.put("/participants/:participantId/attempts", requireJudge, asyncRoute(async (request, response) => {
    const { levelId, attemptNumber, score, durationMs } = request.body || {};
    const level = validateLevel(levelId);
    if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > level.attempts) {
      throw validationError(`This level allows ${level.attempts} evaluation${level.attempts === 1 ? "" : "s"}.`);
    }
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1_000_000) {
      throw validationError("Score must be a number from 0 to 1,000,000.");
    }
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_TIME_MS) {
      throw validationError("Completion time must be greater than zero and no more than 7 days.");
    }
    const [participantRows] = await pool.execute(
      "SELECT id FROM scoring_participants WHERE id = ? AND level_id = ? LIMIT 1",
      [request.params.participantId, levelId]
    );
    if (!participantRows.length) throw validationError("Participant not found in this level.", 404);
    await pool.execute(
      `INSERT INTO scoring_attempts (participant_id, attempt_number, score, duration_ms)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE score = VALUES(score), duration_ms = VALUES(duration_ms)`,
      [request.params.participantId, attemptNumber, score, durationMs]
    );
    response.json({ ok: true });
  }));

  router.get("/participants/:participantId/media", asyncRoute(async (request, response) => {
    const [rows] = await pool.execute(
      `SELECT id, participant_id, original_name, mime_type, file_size, created_at
       FROM scoring_media WHERE participant_id = ? ORDER BY created_at DESC`,
      [request.params.participantId]
    );
    response.json({
      media: rows.map((row) => ({
        id: row.id,
        participantId: String(row.participant_id),
        name: row.original_name,
        mimeType: row.mime_type,
        size: Number(row.file_size),
        createdAt: row.created_at
      }))
    });
  }));

  router.post("/media/:mediaId/access", asyncRoute(async (request, response) => {
    const [rows] = await pool.execute("SELECT id FROM scoring_media WHERE id = ? LIMIT 1", [request.params.mediaId]);
    if (!rows.length) throw validationError("Media file not found.", 404);
    await pool.execute("DELETE FROM scoring_media_tickets WHERE expires_at_ms <= ?", [Date.now()]);
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    await pool.execute(
      "INSERT INTO scoring_media_tickets (token_hash, media_id, expires_at_ms) VALUES (?, ?, ?)",
      [hashToken(ticket), request.params.mediaId, expiresAt]
    );
    response.json({ ticket, expiresAt });
  }));

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => callback(null, mediaDirectory),
      filename: (_request, file, callback) => {
        const extension = MIME_EXTENSIONS.get(file.mimetype);
        callback(extension ? null : validationError("Upload a JPG, PNG, WebP, MP4, WebM, or MOV file."), `${randomUUID()}${extension || ""}`);
      }
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (_request, file, callback) => callback(null, MIME_EXTENSIONS.has(file.mimetype))
  });

  router.post("/participants/:participantId/media", upload.single("file"), asyncRoute(async (request, response) => {
    if (!request.file) throw validationError("Choose a photo or video to upload.");
    const id = randomUUID();
    let connection;
    let name;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [participants] = await connection.execute(
        "SELECT id, name FROM scoring_participants WHERE id = ? FOR UPDATE",
        [request.params.participantId]
      );
      if (!participants.length) throw validationError("Participant not found.", 404);
      const mediaType = request.file.mimetype.startsWith("video/") ? "video" : "photo";
      const [countRows] = await connection.execute(
        "SELECT COUNT(*) AS total FROM scoring_media WHERE participant_id = ? AND mime_type LIKE ?",
        [request.params.participantId, mediaType === "video" ? "video/%" : "image/%"]
      );
      name = createScoringMediaName(participants[0].name, request.file.mimetype, Number(countRows[0].total) + 1);
      await connection.execute(
        `INSERT INTO scoring_media
          (id, participant_id, file_name, original_name, mime_type, file_size, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id, request.params.participantId, request.file.filename,
          name, request.file.mimetype,
          request.file.size, request.user.id
        ]
      );
      await connection.commit();
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("Scoring media transaction rollback failed:", rollbackError);
        }
      }
      await unlink(request.file.path);
      throw error;
    } finally {
      if (connection) connection.release();
    }
    response.status(201).json({
      media: {
        id,
        participantId: String(request.params.participantId),
        name,
        mimeType: request.file.mimetype,
        size: request.file.size
      }
    });
  }));

  router.get("/media/:mediaId", asyncRoute(async (request, response, next) => {
    const [rows] = await pool.execute("SELECT file_name, mime_type FROM scoring_media WHERE id = ? LIMIT 1", [request.params.mediaId]);
    if (!rows.length) throw validationError("Media file not found.", 404);
    const filePath = path.join(mediaDirectory, path.basename(rows[0].file_name));
    response.set({
      "Cache-Control": "private, max-age=3600",
      "Cross-Origin-Resource-Policy": "cross-origin"
    });
    response.set("Content-Type", rows[0].mime_type);
    createReadStream(filePath).on("error", (error) => {
      if (error.code === "ENOENT") response.status(404).json({ error: "Media file is unavailable." });
      else if (response.headersSent) {
        console.error("Scoring media stream failed:", error);
        response.destroy();
      } else next(error);
    }).pipe(response);
  }));

  router.use((error, _request, response, _next) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "Files must be 200 MB or smaller."
        : "Upload one file at a time.";
      response.status(413).json({ error: message });
      return;
    }
    if (error.status) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Scoring request failed:", error);
    response.status(500).json({ error: "Scoring request could not be completed." });
  });

  const provisionUser = async ({ username, password, role }) => {
    if (!pool || !ready) throw new Error("Scoring database is not ready.");
    if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,80}$/.test(username)) {
      throw new Error("Username must be 3-80 characters (letters, numbers, dot, underscore, or hyphen).");
    }
    if (!["asisten", "juri"].includes(role)) throw new Error("Role must be asisten or juri.");
    validateScoringPassword(password);
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.execute(
      `INSERT INTO scoring_users (username, password_hash, role) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), active = TRUE`,
      [username, passwordHash, role]
    );
    const [rows] = await pool.execute("SELECT id FROM scoring_users WHERE username = ? LIMIT 1", [username]);
    await pool.execute("DELETE FROM scoring_sessions WHERE user_id = ?", [rows[0].id]);
  };

  const seedDefaultUsers = async () => {
    if (!pool || !ready) throw new Error("Scoring database is not ready.");
    const created = [];
    for (const account of [
      { username: "juri", role: "juri" },
      { username: "asisten", role: "asisten" }
    ]) {
      const [existing] = await pool.execute(
        "SELECT id FROM scoring_users WHERE username = ? LIMIT 1",
        [account.username]
      );
      if (existing.length) {
        created.push({ ...account, created: false });
        continue;
      }
      const password = randomBytes(6).toString("base64url");
      const passwordHash = await bcrypt.hash(password, 12);
      const [result] = await pool.execute(
        "INSERT IGNORE INTO scoring_users (username, password_hash, role) VALUES (?, ?, ?)",
        [account.username, passwordHash, account.role]
      );
      created.push(result.affectedRows
        ? { ...account, password, created: true }
        : { ...account, created: false });
    }
    return created;
  };

  const getWinners = async (levelId) => {
    const level = validateLevel(levelId);
    if (!pool || !ready) throw new Error("Scoring database is not ready.");
    const [rows] = await pool.execute(`
      SELECT p.id, p.level_id, p.name,
        DATE_FORMAT(p.birth_date, '%Y-%m-%d') AS birthDate,
        a.attempt_number, a.score, a.duration_ms
      FROM scoring_participants p
      LEFT JOIN scoring_attempts a ON a.participant_id = p.id
      WHERE p.level_id = ?
      ORDER BY p.name, a.attempt_number
    `, [level.id]);
    const participants = summarizeScoringResults(rows)
      .find((item) => item.id === level.id)?.participants || [];
    const winners = participants
      .filter((participant) => participant.place && participant.place <= 3)
      .map((participant) => ({
        place: participant.place,
        name: participant.name,
        score: participant.bestAttempt.score,
        durationMs: participant.bestAttempt.durationMs
      }));
    return {
      levelId: level.id,
      levelName: level.name,
      winners
    };
  };

  return {
    router,
    pool,
    initialize,
    isReady: () => ready,
    getWinners,
    provisionUser,
    seedDefaultUsers,
    close: () => pool?.end()
  };
}
