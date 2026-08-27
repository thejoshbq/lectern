"use server";

import { redirect } from "next/navigation";

import { setSessionCookie } from "./session.ts";
import { unlock } from "./unlock.ts";

export type AuthFormState = { error: string } | null;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  let ok = false;
  try {
    ok = unlock(field(formData, "password"));
  } catch (err) {
    console.error("login failed:", err);
    return { error: "This tool is not configured." };
  }

  if (!ok) return { error: "That password is wrong." };

  await setSessionCookie();
  redirect("/");
}
