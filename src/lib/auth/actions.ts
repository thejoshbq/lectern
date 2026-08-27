"use server";

import { redirect } from "next/navigation";

import { authenticateAccount, registerAccount } from "./accounts.ts";
import { setSessionCookie } from "./session.ts";

export type AuthFormState = { error: string } | null;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const result = await registerAccount({
    email: field(formData, "email"),
    password: field(formData, "password"),
    adminCode: field(formData, "adminCode"),
  });
  if (!result.ok) return { error: result.error };

  await setSessionCookie({ userId: result.user.id, email: result.user.email });
  redirect("/");
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const result = await authenticateAccount({
    email: field(formData, "email"),
    password: field(formData, "password"),
  });
  if (!result.ok) return { error: result.error };

  await setSessionCookie({ userId: result.user.id, email: result.user.email });
  redirect("/");
}
