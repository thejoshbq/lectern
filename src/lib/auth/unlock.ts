import { sitePassword } from "./config.ts";
import { secretsEqual } from "./secret.ts";

/** True when the given password matches the shared site password. */
export function unlock(password: string): boolean {
  if (!password) return false;
  return secretsEqual(password, sitePassword());
}
