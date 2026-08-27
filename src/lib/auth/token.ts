import { jwtVerify, SignJWT } from "jose";

import { SESSION_MAX_AGE_SECONDS } from "./config.ts";

export interface Session {
  userId: string;
  email: string;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(
  session: Session,
  secret: string,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  return new SignJWT({ email: session.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
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
    const email = payload.email;
    const userId = payload.sub;
    if (typeof email !== "string" || !email || !userId) return null;
    return { userId, email };
  } catch {
    return null;
  }
}
