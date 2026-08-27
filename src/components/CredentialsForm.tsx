"use client";

import { useActionState } from "react";

import { loginAction, type AuthFormState } from "@/lib/auth/actions";

export function CredentialsForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    loginAction,
    null,
  );

  const fieldClass =
    "text-ink placeholder:text-ink-faint w-full rounded-lg border border-line bg-raised px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-line-strong";

  return (
    <form action={formAction} className="mt-8 space-y-4">
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
          autoComplete="current-password"
          required
          className={fieldClass}
        />
      </div>

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
        {pending ? "…" : "Sign in"}
      </button>
    </form>
  );
}
