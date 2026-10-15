import type { NextRequest, NextResponse } from "next/server";
import { jsonError } from "./api-response";
import { verifySessionToken, SESSION_COOKIE, type Session } from "./auth";

export function sessionFrom(req: NextRequest): Session | null {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export function requireSession(req: NextRequest): Session | NextResponse {
  return sessionFrom(req) ?? jsonError("Unauthorized", 401);
}

export function requireAdmin(req: NextRequest): Session | NextResponse {
  const session = sessionFrom(req);
  return session?.role === "admin" ? session : jsonError("Unauthorized", 401);
}

/** A signed-in booker, with the email Google verified; anyone else is a guest. */
export type Member = Session & { role: "member"; email: string };

export function memberFrom(req: NextRequest): Member | null {
  const session = sessionFrom(req);
  return session?.role === "member" && session.email
    ? (session as Member)
    : null;
}
