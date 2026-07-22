import { NextRequest, NextResponse } from "next/server";
import { findUserRecordById, resetPassword } from "@/lib/db";
import { requireAllowedOrigin } from "@/lib/cors";
import { MIN_PASSWORD, MAX_PASSWORD } from "@/lib/types";
import {
  verifyResetToken,
  passwordFingerprint,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth";
import type { UserRecord } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Resolve a reset token to its member: signature + purpose + expiry, then the
 * fingerprint must still match the account's current password hash. That last
 * check makes the link single-use (it stops matching once the password changes).
 */
async function resolveToken(
  token: string | undefined | null,
): Promise<UserRecord | null> {
  const v = verifyResetToken(token);
  if (!v) return null;
  const user = await findUserRecordById(v.userId);
  if (!user || !user.activated || !user.passwordHash) return null;
  if (passwordFingerprint(user.passwordHash) !== v.fp) return null;
  return user;
}

const invalid = () =>
  NextResponse.json(
    { ok: false, error: "This reset link is invalid or has expired." },
    { status: 400 },
  );

/** Validate a reset link and return the account email so the page can show it. */
export async function GET(req: NextRequest) {
  const user = await resolveToken(req.nextUrl.searchParams.get("token"));
  if (!user) return invalid();
  return NextResponse.json({ ok: true, email: user.email });
}

/**
 * Complete the reset: set the new password, then sign the member straight in
 * (same as activation), so they land on the reservation screen.
 */
export async function POST(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const { token, password } = (await req.json().catch(() => ({}))) as {
    token?: string;
    password?: string;
  };

  const user = await resolveToken(token);
  if (!user) return invalid();

  const pass = typeof password === "string" ? password : "";
  // Cap the length before hashing: scrypt on an unbounded password burns CPU.
  if (pass.length < MIN_PASSWORD || pass.length > MAX_PASSWORD) {
    return NextResponse.json(
      {
        ok: false,
        error: `Password must be between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters.`,
      },
      { status: 400 },
    );
  }

  try {
    const updated = await resetPassword(user.id, pass);
    const res = NextResponse.json({ ok: true, role: "user" });
    res.cookies.set(
      SESSION_COOKIE,
      createSessionToken({
        role: "user",
        sub: updated.id,
        name: updated.name,
        email: updated.email,
      }),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      },
    );
    return res;
  } catch (err) {
    console.error("[reset-password] POST failed:", err);
    return invalid();
  }
}
