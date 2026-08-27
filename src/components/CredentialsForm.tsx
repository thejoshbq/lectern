"use client";

import { useActionState } from "react";

import {
  loginAction,
  registerAction,
  type AuthFormState,
} from "@/lib/auth/actions";

export function CredentialsForm({
  mode,
}: {
  mode: "login" | "register";
}) {
  const registering = mode === "register";
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    registering ? registerAction : loginAction,
    null,
  );

  const fieldClass =
    "text-ink placeholder:text-ink-faint w-full rounded-lg border border-line bg-raised px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-line-strong";

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className="text-ink-muted mb-1.5 block text-xs">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={fieldClass}
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="text-ink-muted mb-1.5 block text-xs"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={registering ? "new-password" : "current-password"}
          required
          minLength={registering ? 10 : undefined}
          className={fieldClass}
        />
        {registering && (
          <p className="text-ink-faint mt-1.5 text-xs">
            At least 10 characters.
          </p>
        )}
      </div>

      {registering && (
        <div>
          <label
            htmlFor="adminCode"
            className="text-ink-muted mb-1.5 block text-xs"
          >
            Invite code
          </label>
          <input
            id="adminCode"
            name="adminCode"
            type="password"
            autoComplete="off"
            required
            className={fieldClass}
          />
          <p className="text-ink-faint mt-1.5 text-xs">
            Accounts can only be created with this code. It is not a password
            for signing in.
          </p>
        </div>
      )}

      {state?.error && (
        <div className="border-danger/40 bg-danger/10 text-ink rounded-lg border px-4 py-3 text-sm">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-overlay text-ink hover:bg-line focus-visible:ring-accent/50 w-full rounded-lg px-3.5 py-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "…" : registering ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
