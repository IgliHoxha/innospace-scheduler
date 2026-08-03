// Route guards, split from auth.ts since these pull in Next types; each returns a Session or a 401/403.
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
