import { z } from "zod";

import { hashPassword, verifyPassword } from "./password.ts";
import { adminSignupCode } from "./config.ts";
import { secretsEqual } from "./secret.ts";
import { insertUser, findUserByEmail, type UserRecord } from "./users.ts";

const emailSchema = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .email()
  .transform((value) => value.toLowerCase());

const registerSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(10, "Use a password of at least 10 characters.")
    .max(200),
  adminCode: z.string().min(1, "An invite code is required.").max(200),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export type AccountResult =
  | { ok: true; user: Pick<UserRecord, "id" | "email"> }
  | { ok: false; error: string; status: number };

export async function registerAccount(input: unknown): Promise<AccountResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid details.";
    return { ok: false, error: message, status: 400 };
  }

  const expected = adminSignupCode();
  if (!expected || !secretsEqual(parsed.data.adminCode, expected)) {
    return {
      ok: false,
      error: "That invite code is not valid.",
      status: 403,
    };
  }

  const existing = await findUserByEmail(parsed.data.email);
  if (existing) {
    return {
      ok: false,
      error: "An account with that email already exists.",
      status: 409,
    };
  }

  const user: UserRecord = {
    id: crypto.randomUUID(),
    email: parsed.data.email,
    passwordHash: await hashPassword(parsed.data.password),
  };

  const inserted = await insertUser(user);
  if (inserted === "duplicate") {
    return {
      ok: false,
      error: "An account with that email already exists.",
      status: 409,
    };
  }

  return { ok: true, user: { id: user.id, email: user.email } };
}

export async function authenticateAccount(
  input: unknown,
): Promise<AccountResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Email or password is wrong.",
      status: 400,
    };
  }

  const user = await findUserByEmail(parsed.data.email);
  if (!user) {
    return { ok: false, error: "Email or password is wrong.", status: 401 };
  }

  const matches = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!matches) {
    return { ok: false, error: "Email or password is wrong.", status: 401 };
  }

  return { ok: true, user: { id: user.id, email: user.email } };
}
