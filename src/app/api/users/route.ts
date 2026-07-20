import { NextRequest, NextResponse } from "next/server";
import { listUsers, inviteUser, DuplicateEmailError } from "@/lib/db";
import { createInviteToken } from "@/lib/auth";
import { requireAdmin } from "@/lib/api-auth";
import { sendInviteEmail } from "@/lib/email";
import { MAX_EMAIL } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Admin-only: list all members. */
export async function GET(req: NextRequest) {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json({ ok: true, users: await listUsers() });
}

/**
 * Admin-only: invite a member by email. Creates a pending record and emails an
 * activation link; the member sets their own name + password. Re-posting a
 * pending email resends the invite.
 */
export async function POST(req: NextRequest) {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL) {
    return NextResponse.json(
      { ok: false, error: "A valid email is required." },
      { status: 400 },
    );
  }

  try {
    const user = await inviteUser(email);
    const token = createInviteToken(user.id);
    try {
      await sendInviteEmail(user.email, token);
    } catch (err) {
      console.error("[users] invite email failed:", err);
      return NextResponse.json(
        {
          ok: false,
          error: "Member added, but the invite email could not be sent.",
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, user }, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 409 },
      );
    }
    console.error("[users] POST failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not invite the member." },
      { status: 400 },
    );
  }
}
