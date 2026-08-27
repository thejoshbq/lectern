import { jwtVerify, SignJWT } from "jose";

import { SESSION_MAX_AGE_SECONDS } from "./config.ts";

/** Marker stored as the JWT subject. Old account tokens used a user id here. */
export const SESSION_SUBJECT = "lectern";

export interface Session {
  unlocked: true;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(
  secret: string,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(SESSION_SUBJECT)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secretKey(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ["HS256"],
    });
    if (payload.sub !== SESSION_SUBJECT) return null;
    return { unlocked: true };
  } catch {
    return null;
  }
}
