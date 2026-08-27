import { NextResponse, type NextRequest } from "next/server";

import { authSecret, SESSION_COOKIE } from "@/lib/auth/config";
import { verifySession } from "@/lib/auth/token";

/**
 * Optimistic gate: send visitors without a valid session to sign in before
 * the page renders. This is not the authorization boundary — `/api/ask`
 * checks the session itself, because a proxy can be skipped.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const publicPath =
    pathname === "/login" || pathname.startsWith("/api/auth/");

  if (publicPath) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token, authSecret()) : null;

  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  const response = NextResponse.redirect(login);
  if (token) {
    response.cookies.delete(SESSION_COOKIE);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
