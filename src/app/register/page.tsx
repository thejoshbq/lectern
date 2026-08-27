import { CredentialsForm } from "@/components/CredentialsForm";

export default function RegisterPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-16">
      <h1 className="text-ink text-sm font-medium tracking-[0.2em] uppercase">
        Lectern
      </h1>
      <p className="text-ink mt-8 text-xl leading-relaxed">Create an account</p>
      <p className="text-ink-muted mt-2 text-sm leading-relaxed">
        Registration is invite-only. Without the code, a new account cannot be
        created — which is how the model keys stay off the public internet.
      </p>
      <CredentialsForm mode="register" />
      <p className="text-ink-faint mt-6 text-sm">
        Already have an account?{" "}
        <a
          href="/login"
          className="text-ink-muted hover:text-ink underline underline-offset-2"
        >
          Sign in
        </a>
      </p>
    </div>
  );
}
