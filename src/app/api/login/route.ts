import { NextRequest, NextResponse } from "next/server";
import {
  checkAdminCredentials,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type Session,
} from "@/lib/auth";
import { requireSession } from "@/lib/api-auth";
import { jsonBody } from "@/lib/api-request";
import { jsonError } from "@/lib/api-response";
import { requireAllowedOrigin } from "@/lib/cors";
import { requireEnv } from "@/lib/env-app";
import { MAX_EMAIL, MAX_PASSWORD } from "@/lib/types";
import {
  checkLoginBlocked,
  clientKey,
  registerLoginFailure,
  registerLoginSuccess,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

function formatWait(seconds: number): string {
  if (seconds >= 60) {
    const mins = Math.ceil(seconds / 60);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function bannedResponse() {
  return jsonError(
    "Access blocked due to repeated failed logins. Contact the administrator.",
    403,
  );
}

function lockedResponse(retryAfterSeconds: number) {
  return jsonError(
    `Too many failed attempts. Try again in ${formatWait(retryAfterSeconds)}.`,
    429,
    { "Retry-After": String(retryAfterSeconds) },
  );
}

function failedLogin(ip: string, login: string): NextResponse {
  const s = registerLoginFailure(ip, login);
  if (s.banned) return bannedResponse();
  if (s.blocked) return lockedResponse(s.retryAfterSeconds);
  return jsonError("Incorrect login or password.", 401);
}

export async function POST(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const ip = clientKey(req.headers);

  const body = await jsonBody(req);
  // Strings only: anything else would throw further down instead of being refused.
  const login = typeof body.login === "string" ? body.login : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!login || !password) {
    return jsonError("Enter your login and password.", 400);
  }

  const gate = checkLoginBlocked(ip, login);
  if (gate.banned) return bannedResponse();
  if (gate.blocked) return lockedResponse(gate.retryAfterSeconds);

  // Oversized input counts as a failed attempt and never reaches the compare.
  if (login.length > MAX_EMAIL || password.length > MAX_PASSWORD) {
    return failedLogin(ip, login);
  }
  if (!checkAdminCredentials(login, password)) return failedLogin(ip, login);

  const session: Session = {
    role: "admin",
    sub: "admin",
    name: requireEnv("DASHBOARD_USERNAME"),
  };
  registerLoginSuccess(ip, login);

  const res = NextResponse.json({ ok: true, role: session.role });
  res.cookies.set(SESSION_COOKIE, createSessionToken(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS, // matches the token's signed expiry
  });
  return res;
}

// Session-guarded, so a forged cross-site DELETE cannot clear the cookie.
export async function DELETE(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const session = requireSession(req);
  if (session instanceof NextResponse) return session;

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
