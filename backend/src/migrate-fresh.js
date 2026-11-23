import { loadBackendEnv } from "./env.js";
import { createScoringPool, runFreshScoringMigrations } from "./scoring.js";

loadBackendEnv();

const databaseName = process.env.MYSQL_URL
  ? "configured in MYSQL_URL"
  : process.env.MYSQL_DATABASE || "competition_timer";

if (!process.argv.includes("--confirm")) {
  console.error(
    `Refusing to delete scoring tables in database "${databaseName}" without confirmation.\n` +
    "Run: npm run migrate:fresh -- --confirm"
  );
  process.exitCode = 1;
} else {
  let pool;
  try {
    pool = createScoringPool();
    await pool.query("SELECT 1");
    const applied = await runFreshScoringMigrations(pool);
    console.log(`Fresh scoring migration completed for database "${databaseName}".`);
    console.log(`Scoring migrations applied: ${applied.join(", ") || "none"}.`);
    console.log("Note: media files stored on disk were not deleted.");
  } catch (error) {
    if (error.code === "ER_BAD_DB_ERROR") {
      console.error(
        `Database "${databaseName}" does not exist. ` +
        "Create it in MySQL or phpMyAdmin, then run npm run migrate:fresh -- --confirm again."
      );
    } else {
      console.error("Fresh scoring database migration failed:", error.message);
    }
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}
