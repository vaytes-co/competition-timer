import { loadBackendEnv } from "./env.js";
import { createScoringPool, runScoringMigrations } from "./scoring.js";

loadBackendEnv();

let pool;
try {
  pool = createScoringPool();
  await pool.query("SELECT 1");
  const applied = await runScoringMigrations(pool);
  if (applied.length) {
    console.log(`Scoring database migrations applied: ${applied.join(", ")}`);
  } else {
    console.log("Scoring database is already up to date.");
  }
} catch (error) {
  if (error.code === "ER_BAD_DB_ERROR") {
    const databaseName = process.env.MYSQL_URL
      ? "configured in MYSQL_URL"
      : process.env.MYSQL_DATABASE || "competition_timer";
    console.error(
      `Database "${databaseName}" does not exist. ` +
      "Create it in MySQL or phpMyAdmin, then run npm run migrate again."
    );
  } else {
    console.error("Scoring database migration failed:", error.message);
  }
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
