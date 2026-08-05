import { NextRequest, NextResponse } from "next/server";
import { getReservation, updateReservationStatus } from "@/lib/db";
import { sendReservationEmail } from "@/lib/email";
import { boothName } from "@/lib/booths";
import { postReservationToSlack } from "@/lib/slack";
import { requireAdmin } from "@/lib/api-auth";
import { requireAllowedOrigin } from "@/lib/cors";
import {
  RESERVATION_STATUSES,
  MAX_EMAIL_BODY,
  type ReservationStatus,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only approve, cancel or delete; whoever booked uses the signed link in their email. */
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
    status?: ReservationStatus;
    emailBody?: string;
  };

  if (!status || !RESERVATION_STATUSES.includes(status)) {
    return NextResponse.json(
      { ok: false, error: "Invalid status." },
      { status: 400 },
    );
  }
  if (typeof emailBody === "string" && emailBody.length > MAX_EMAIL_BODY) {
    return NextResponse.json(
      { ok: false, error: "That email body is too long." },
      { status: 400 },
    );
  }

  // Only a pending row turns into an approval; both calls are synchronous, so nothing interleaves.
  const before = getReservation(id);
  // One atomic UPDATE ... RETURNING: a separate existence read would only add a race window.
  const reservation = updateReservationStatus(id, status);
  if (!reservation) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }

  // Notify the member on confirm/cancel. Never block the response on email.
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

  // The booking was announced when it was made, so only a verdict on it is news.
  if (status === "cancelled") {
    await postReservationToSlack(reservation, "cancelled", boothName, "admin");
  } else if (status === "confirmed" && before?.status === "pending") {
    await postReservationToSlack(reservation, "approved", boothName);
  }

  return NextResponse.json({ ok: true, reservation });
}
