import { NextRequest, NextResponse } from "next/server";
import { getReservation, updateReservationStatus } from "@/lib/db";
import { verifyCancelToken } from "@/lib/auth";
import { requireAllowedOrigin } from "@/lib/cors";
import { ACTIVE_STATUSES } from "@/lib/types";
import { boothName } from "@/lib/booths";
import { postReservationToSlack } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancel from the emailed link; the token names one slot and dies with it. */
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

  const existing = getReservation(id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "That reservation no longer exists." },
      { status: 404 },
    );
  }

  // Already cancelled: success, so a double-click reads as done, not an error.
  if (!ACTIVE_STATUSES.includes(existing.status as "confirmed" | "pending")) {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  const reservation = updateReservationStatus(id, "cancelled");
  if (!reservation) {
    return NextResponse.json(
      { ok: false, error: "That reservation no longer exists." },
      { status: 404 },
    );
  }

  // The channel hears it though the guest gets no email: the slot is free again.
  await postReservationToSlack(reservation, "cancelled", boothName, "guest");

  // No email: their own action, and the template is written for an admin cancelling.
  return NextResponse.json({ ok: true, alreadyCancelled: false });
}
