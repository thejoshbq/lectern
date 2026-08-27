import { cookies } from "next/headers";

import {
  authSecret,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "./config.ts";
import { signSession, verifySession, type Session } from "./token.ts";

export type { Session };

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token, authSecret());
}

export async function setSessionCookie(session: Session): Promise<void> {
  const token = await signSession(session, authSecret());
  (await cookies()).set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
  );
}
