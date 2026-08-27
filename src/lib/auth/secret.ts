import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for the invite code (and anything else that must
 * not leak length or prefix through early return).
 *
 * Both sides are hashed to a fixed-width digest first so `timingSafeEqual`
 * can run even when the strings differ in length.
 */
export function secretsEqual(given: string, expected: string): boolean {
  if (expected.length === 0) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
