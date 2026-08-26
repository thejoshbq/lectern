import { existsSync } from "node:fs";
import { join } from "node:path";

let loaded = false;

/**
 * Loads .env.local then .env for CLI scripts.
 *
 * Next.js does this for the web app already; this exists so the scripts in
 * scripts/ behave the same way when run directly.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  for (const name of [".env.local", ".env"]) {
    const path = join(process.cwd(), name);
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
    } catch {
      // A malformed env file should not take down the command; the resulting
      // missing-key error downstream is clearer than a parse failure here.
    }
  }
}
