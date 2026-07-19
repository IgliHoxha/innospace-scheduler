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

export const runtime = "nodejs";

/**
 * Login for both roles. The admin signs in with the env username; members sign
 * in with their email. Both use the same form field ("login").
 */
export async function POST(req: NextRequest) {
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
  // Reject oversized input before it reaches scrypt (unbounded input burns CPU).
  if (login.length > MAX_EMAIL || password.length > MAX_PASSWORD) {
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
    return NextResponse.json(
      { ok: false, error: "Incorrect login or password." },
      { status: 401 },
    );
  }

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
