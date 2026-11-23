import { loadBackendEnv } from "./env.js";
import { createScoringRouter } from "./scoring.js";

loadBackendEnv();

const username = process.env.SCORING_USERNAME;
const role = process.env.SCORING_ROLE;
const password = process.env.SCORING_PASSWORD;
const scoring = createScoringRouter();

try {
  if (!username || !role || !password) {
    throw new Error("Set SCORING_USERNAME, SCORING_ROLE (asisten or juri), and SCORING_PASSWORD.");
  }
  await scoring.initialize();
  await scoring.provisionUser({ username, role, password });
  console.log(`Scoring ${role} account "${username}" is ready.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await scoring.close();
}
