import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEYLEN = 32;
const N = 16384;
const R = 8;
const P = 1;

function deriveKey(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

/**
 * Hash a password with scrypt. The parameters are stored alongside the hash
 * so they can be raised later without invalidating existing accounts.
 *
 * Format: `scrypt$N$r$p$salt$hash`, salt and hash as base64url.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }

  if (salt.length === 0 || expected.length === 0) return false;

  const key = await deriveKey(password, salt, expected.length, {
    N: n,
    r,
    p,
  });

  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}
