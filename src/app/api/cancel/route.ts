import { NextRequest, NextResponse } from "next/server";
import { getReservation, updateReservationStatus } from "@/lib/db";
import { verifyCancelToken } from "@/lib/auth";
import { requireAllowedOrigin } from "@/lib/cors";
import { ACTIVE_STATUSES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cancel a reservation from the link in its confirmation email. The signed token
 * is the only proof of ownership, so it is the whole authorisation: it names one
 * reservation and expires when that slot ends.
 */
export async function POST(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const { token } = (await req.json().catch(() => ({}))) as { token?: unknown };
  const id = verifyCancelToken(typeof token === "string" ? token : undefined);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "This cancellation link is no longer valid." },
      { status: 400 },
    );
  }

  const existing = await getReservation(id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "That reservation no longer exists." },
      { status: 404 },
    );
  }

  // Already cancelled (or deleted): report success so a double-click reads as
  // done rather than as an error.
  if (!ACTIVE_STATUSES.includes(existing.status as "confirmed" | "pending")) {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  const reservation = await updateReservationStatus(id, "cancelled");
  if (!reservation) {
    return NextResponse.json(
      { ok: false, error: "That reservation no longer exists." },
      { status: 404 },
    );
  }

  // No email here: this is the person's own action, and the cancellation
  // template is written for the admin cancelling on them.
  return NextResponse.json({ ok: true, alreadyCancelled: false });
}
