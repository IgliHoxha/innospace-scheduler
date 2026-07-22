import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail } from "@/lib/db";
import { createResetToken } from "@/lib/auth";
import { requireAllowedOrigin } from "@/lib/cors";
import { sendPasswordResetEmail } from "@/lib/email";
import { MAX_EMAIL } from "@/lib/types";
import {
  checkResetBlocked,
  clientKey,
  registerResetRequest,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

// Same generic reply whether or not the email belongs to a member: the endpoint
// must never reveal who has an account.
const GENERIC = {
  ok: true as const,
  message:
    "If that email belongs to a member, we've sent a password reset link.",
};

function throttled(retryAfterSeconds: number) {
  return NextResponse.json(
    { ok: false, error: "Too many reset requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/**
 * Start a password reset: email a member a one-time reset link. Always answers
 * with the same generic success (no account enumeration); only an existing,
 * activated account actually receives mail. Rate-limited per IP to curb inbox
 * spam. Not-yet-activated invitees are left to their invite link.
 */
export async function POST(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const ip = clientKey(req.headers);
  const gate = checkResetBlocked(ip);
  if (gate.blocked) return throttled(gate.retryAfterSeconds);

  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const addr = typeof email === "string" ? email.trim() : "";

  // Every request counts toward the throttle, even an invalid one, so it can't be
  // hammered. We still return the generic message for a malformed address.
  const status = registerResetRequest(ip);
  if (status.blocked) return throttled(status.retryAfterSeconds);

  if (addr && addr.length <= MAX_EMAIL) {
    const user = await findUserByEmail(addr);
    // Only activated members have a password to reset; invitees use their invite.
    if (user && user.activated && user.passwordHash) {
      try {
        const token = createResetToken(user.id, user.passwordHash);
        await sendPasswordResetEmail(user.email, token);
      } catch (err) {
        // Everything member-specific stays inside the guard: a throw here (mailer
        // down, or a missing env like PASSWORD_RESET_TTL_MINUTES that only this
        // branch reads) must not surface. A 500 for a real account while an
        // unknown one gets 200 would be an account-enumeration oracle.
        console.error("[forgot-password] reset link failed:", err);
      }
    }
  }

  return NextResponse.json(GENERIC);
}
