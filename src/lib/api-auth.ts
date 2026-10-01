import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, type Session } from "./auth";

function deny(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export function sessionFrom(req: NextRequest): Session | null {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export function requireSession(req: NextRequest): Session | NextResponse {
  return sessionFrom(req) ?? deny("Unauthorized", 401);
}

export function requireAdmin(req: NextRequest): Session | NextResponse {
  const session = sessionFrom(req);
  return session?.role === "admin" ? session : deny("Unauthorized", 401);
}
