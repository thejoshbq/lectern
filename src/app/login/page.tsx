import { CredentialsForm } from "@/components/CredentialsForm";

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-16">
      <h1 className="text-ink text-sm font-medium tracking-[0.2em] uppercase">
        Lectern
      </h1>
      <p className="text-ink mt-8 text-xl leading-relaxed">Sign in</p>
      <p className="text-ink-muted mt-2 text-sm leading-relaxed">
        This tool is private. Enter the password to use it.
      </p>
      <CredentialsForm />
    </div>
  );
}
