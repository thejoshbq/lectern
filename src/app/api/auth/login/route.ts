import { NextResponse } from "next/server";

import { authenticateAccount } from "@/lib/auth/accounts";
import { setSessionCookie } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  try {
    const result = await authenticateAccount(payload);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    await setSessionCookie({ userId: result.user.id, email: result.user.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("login failed:", err);
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Something went wrong.",
      },
      { status: 500 },
    );
  }
}
