import { NextRequest, NextResponse } from "next/server";
import { getReservation, updateReservationStatus } from "@/lib/db";
import { sendReservationEmail } from "@/lib/email";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { RESERVATION_STATUSES, MAX_EMAIL_BODY } from "@/lib/types";
import type { ReservationStatus } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Update a reservation's status. Admin can cancel or delete any booking;
 * a member may only cancel their own.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

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

  const existing = await getReservation(id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }

  // Members can only cancel their own bookings; admins can do anything.
  if (session.role !== "admin") {
    if (existing.userId !== session.sub || status !== "cancelled") {
      return NextResponse.json(
        { ok: false, error: "Forbidden." },
        { status: 403 },
      );
    }
  }

  const reservation = await updateReservationStatus(id, status);
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

  return NextResponse.json({ ok: true, reservation });
}
