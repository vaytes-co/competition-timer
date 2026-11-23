import { loadBackendEnv } from "./env.js";
import { createScoringRouter } from "./scoring.js";

loadBackendEnv();

const scoring = createScoringRouter();

try {
  await scoring.initialize();
  const accounts = await scoring.seedDefaultUsers();
  const created = accounts.filter((account) => account.created);

  if (!created.length) {
    console.log("Seed accounts already exist. Existing accounts and passwords were left unchanged.");
  } else {
    console.log("Save these one-time scoring credentials:");
    for (const account of created) {
      console.log(`${account.role.toUpperCase()} username: ${account.username}`);
      console.log(`${account.role.toUpperCase()} password: ${account.password}`);
    }
    for (const account of accounts.filter((item) => !item.created)) {
      console.log(`${account.role.toUpperCase()} account "${account.username}" already exists; it was not changed.`);
    }
  }
} catch (error) {
  console.error("Scoring account seeding failed:", error.message);
  process.exitCode = 1;
} finally {
  await scoring.close();
}
