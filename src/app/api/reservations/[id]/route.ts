import { NextRequest, NextResponse } from "next/server";
import { getReservation, updateReservationStatus } from "@/lib/db";
import { sendReservationEmail } from "@/lib/email";
import { boothName } from "@/lib/booths";
import { postReservationToSlack } from "@/lib/slack";
import { requireAdmin } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-response";
import { requireAllowedOrigin } from "@/lib/cors";
import { isReservationStatus, MAX_EMAIL_BODY } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only approve, cancel or delete; the booker uses their emailed link. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;
  const { status, emailBody } = (await req.json().catch(() => ({}))) as {
    status?: unknown;
    emailBody?: unknown;
  };

  if (!isReservationStatus(status)) {
    return jsonError("Invalid status.", 400);
  }
  if (typeof emailBody === "string" && emailBody.length > MAX_EMAIL_BODY) {
    return jsonError("That email body is too long.", 400);
  }

  // Only a pending row becomes an approval; sync reads cannot interleave.
  const before = getReservation(id);
  // One atomic UPDATE ... RETURNING: a separate existence read would race.
  const reservation = updateReservationStatus(id, status);
  if (!reservation) {
    return jsonError("Not found.", 404);
  }

  // A failed email must not fail the status change.
  if (status === "confirmed" || status === "cancelled") {
    try {
      await sendReservationEmail(
        reservation,
        status,
        typeof emailBody === "string" ? emailBody : undefined,
      );
    } catch (err) {
      console.error("[reservations] status email failed:", err);
    }
  }

  // The booking was announced when made, so only a verdict on it is news.
  if (status === "cancelled") {
    await postReservationToSlack(reservation, "cancelled", boothName, "admin");
  } else if (status === "confirmed" && before?.status === "pending") {
    await postReservationToSlack(reservation, "approved", boothName);
  }

  return NextResponse.json({ ok: true, reservation });
}
