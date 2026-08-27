export const SESSION_COOKIE = "lectern_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or shorter than 32 characters. Generate one with: openssl rand -base64 32",
    );
  }
  return secret;
}

/**
 * Shared password that unlocks the web app. Absent or empty means the
 * gate is closed — fail closed rather than accidentally let anyone spend
 * model tokens.
 */
export function sitePassword(): string {
  const password = process.env.LECTERN_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "LECTERN_PASSWORD is missing. Set a shared password in the environment so the app is not open to the public.",
    );
  }
  return password;
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
