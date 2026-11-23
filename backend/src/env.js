import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectDirectory = path.resolve(backendDirectory, "..");

export function loadBackendEnv() {
  config({
    path: [
      path.join(projectDirectory, ".env"),
      path.join(backendDirectory, ".env")
    ]
  });
}
