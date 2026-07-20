// Auth guards for API route handlers. Kept separate from auth.ts (which is pure
// crypto, no Next dependency) because these pull in NextRequest/NextResponse.
//
// Usage — the guard returns the Session, or a ready-made 401/403 response to
// return as-is:
//
//   const session = requireSession(req);
//   if (session instanceof NextResponse) return session;
//   // session is now a narrowed Session
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, type Session } from "./auth";

function deny(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

/** The verified session on a request, or null if unauthenticated. */
export function sessionFrom(req: NextRequest): Session | null {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Require any signed-in session; 401 otherwise. */
export function requireSession(req: NextRequest): Session | NextResponse {
  return sessionFrom(req) ?? deny("Unauthorized", 401);
}

/** Require an admin session; 401 otherwise. */
export function requireAdmin(req: NextRequest): Session | NextResponse {
  const session = sessionFrom(req);
  return session?.role === "admin" ? session : deny("Unauthorized", 401);
}
