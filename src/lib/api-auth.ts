// Auth guards for route handlers. Separate from auth.ts (pure crypto, no Next
// dep) since these pull in Next types. Each returns the Session, or a ready-made
// 401/403 to return as-is: `if (x instanceof NextResponse) return x`.
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "./auth";
import type { Session } from "./auth";

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
