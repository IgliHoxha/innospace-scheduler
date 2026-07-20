import { NextRequest, NextResponse } from "next/server";
import {
  checkAdminCredentials,
  createSessionToken,
  verifyPassword,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type Session,
} from "@/lib/auth";
import { findUserByEmail } from "@/lib/db";
import { MAX_EMAIL, MAX_PASSWORD } from "@/lib/types";
import {
  checkLoginBlocked,
  clientKey,
  registerLoginFailure,
  registerLoginSuccess,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

// Human-friendly "2 minutes" / "45 seconds" for the lockout message.
function formatWait(seconds: number): string {
  if (seconds >= 60) {
    const mins = Math.ceil(seconds / 60);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function bannedResponse() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Access blocked due to repeated failed logins. Contact the administrator.",
    },
    { status: 403 },
  );
}

function lockedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      ok: false,
      error: `Too many failed attempts. Try again in ${formatWait(retryAfterSeconds)}.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/**
 * Login for both roles. The admin signs in with the env username; members sign
 * in with their email. Both use the same form field ("login").
 */
export async function POST(req: NextRequest) {
  const ip = clientKey(req.headers);

  const { login, password } = (await req.json().catch(() => ({}))) as {
    login?: string;
    password?: string;
  };

  if (!login || !password) {
    return NextResponse.json(
      { ok: false, error: "Enter your login and password." },
      { status: 400 },
    );
  }

  // Throttle: reject early if this IP or account is already blocked.
  const gate = checkLoginBlocked(ip, login);
  if (gate.banned) return bannedResponse();
  if (gate.blocked) return lockedResponse(gate.retryAfterSeconds);

  // Reject oversized input before it reaches scrypt (unbounded input burns CPU).
  if (login.length > MAX_EMAIL || password.length > MAX_PASSWORD) {
    const s = registerLoginFailure(ip, login);
    if (s.banned) return bannedResponse();
    if (s.blocked) return lockedResponse(s.retryAfterSeconds);
    return NextResponse.json(
      { ok: false, error: "Incorrect login or password." },
      { status: 401 },
    );
  }

  let session: Session | null = null;

  // Admin first (env credentials).
  if (checkAdminCredentials(login, password)) {
    session = {
      role: "admin",
      sub: "admin",
      name: process.env.DASHBOARD_USERNAME || "admin",
    };
  } else {
    // Otherwise a member, keyed by email.
    const user = await findUserByEmail(login);
    if (user && verifyPassword(password, user.passwordHash)) {
      session = {
        role: "user",
        sub: user.id,
        name: user.name,
        email: user.email,
      };
    }
  }

  if (!session) {
    const s = registerLoginFailure(ip, login);
    if (s.banned) return bannedResponse();
    if (s.blocked) return lockedResponse(s.retryAfterSeconds);
    return NextResponse.json(
      { ok: false, error: "Incorrect login or password." },
      { status: 401 },
    );
  }

  registerLoginSuccess(ip, login); // clear the failure history on success

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

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
