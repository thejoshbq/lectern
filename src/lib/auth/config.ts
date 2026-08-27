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
 * Shared invite code required to create an account. Absent or empty means
 * registration is closed — fail closed rather than accidentally allow anyone
 * to mint a user and spend model tokens.
 */
export function adminSignupCode(): string | undefined {
  const code = process.env.LECTERN_ADMIN_CODE;
  if (!code) return undefined;
  return code.length > 0 ? code : undefined;
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
