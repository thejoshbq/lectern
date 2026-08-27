import { CredentialsForm } from "@/components/CredentialsForm";

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-16">
      <h1 className="text-ink text-sm font-medium tracking-[0.2em] uppercase">
        Lectern
      </h1>
      <p className="text-ink mt-8 text-xl leading-relaxed">Sign in</p>
      <p className="text-ink-muted mt-2 text-sm leading-relaxed">
        This tool is private. Sign in with an account that was created with an
        invite code.
      </p>
      <CredentialsForm mode="login" />
      <p className="text-ink-faint mt-6 text-sm">
        Have an invite code?{" "}
        <a
          href="/register"
          className="text-ink-muted hover:text-ink underline underline-offset-2"
        >
          Create an account
        </a>
      </p>
    </div>
  );
}
