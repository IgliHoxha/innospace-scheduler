import { NextRequest, NextResponse, after } from "next/server";
import { memberFrom, type Member } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-response";
import { requireAllowedOrigin } from "@/lib/cors";
import {
  getReservation,
  updateReservationEnd,
  updateReservationStatus,
} from "@/lib/db";
import { canonicalEmail } from "@/lib/guest";
import { boothName } from "@/lib/booths";
import { postReservationToSlack } from "@/lib/slack";
import { sendGuestCancellationEmail } from "@/lib/email";
import { nowDateTime } from "@/lib/datetime";
import {
  CANCEL_OVER_MESSAGE,
  END_ONLY_ONGOING_MESSAGE,
  NOT_ACTIVE_MESSAGE,
  NOT_FOUND_MESSAGE,
  phaseOf,
} from "@/lib/my-bookings";
import { isActiveStatus, type Reservation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The member, or the response refusing them. */
function guard(req: NextRequest): Member | NextResponse {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;
  return memberFrom(req) ?? jsonError("Please sign in first.", 401);
}

/** Someone else's booking reads as missing, so an id proves nothing. */
function ownBooking(member: Member, id: string): Reservation | null {
  const r = getReservation(id);
  if (!r || r.status === "deleted" || !r.email) return null;
  return canonicalEmail(r.email) === canonicalEmail(member.email) ? r : null;
}

/** Cancels it, then sends the receipt and the notice once the member has their answer. */
function cancelOwn(existing: Reservation): NextResponse {
  const reservation = updateReservationStatus(existing.id, "cancelled");
  if (!reservation) return jsonError(NOT_FOUND_MESSAGE, 404);

  // A receipt that also takes it off their calendar, as with the emailed link.
  after(async () => {
    await sendGuestCancellationEmail([reservation]);
    await postReservationToSlack(reservation, "cancelled", boothName, "guest");
  });
  return NextResponse.json({ ok: true, reservation });
}

/** Cancels a booking that is not over yet, one under way included. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const member = guard(req);
  if (member instanceof NextResponse) return member;

  const existing = ownBooking(member, (await params).id);
  if (!existing) return jsonError(NOT_FOUND_MESSAGE, 404);
  if (!isActiveStatus(existing.status)) {
    return jsonError(NOT_ACTIVE_MESSAGE, 409);
  }
  if (phaseOf(existing.startsAt!, existing.endsAt!, nowDateTime()) === "past") {
    return jsonError(CANCEL_OVER_MESSAGE, 400);
  }
  return cancelOwn(existing);
}

/** Ends a booking under way at this minute: the server's clock is the new end, the body is never read. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const member = guard(req);
  if (member instanceof NextResponse) return member;

  const existing = ownBooking(member, (await params).id);
  if (!existing) return jsonError(NOT_FOUND_MESSAGE, 404);
  if (!isActiveStatus(existing.status)) {
    return jsonError(NOT_ACTIVE_MESSAGE, 409);
  }

  const now = nowDateTime();
  if (phaseOf(existing.startsAt!, existing.endsAt!, now) !== "ongoing") {
    return jsonError(END_ONLY_ONGOING_MESSAGE, 400);
  }
  // Ended in the minute it began, it used no time, and a booking cannot be zero long.
  if (now === existing.startsAt) return cancelOwn(existing);

  const reservation = updateReservationEnd(existing.id, now);
  if (!reservation) return jsonError(NOT_ACTIVE_MESSAGE, 409);
  after(() =>
    postReservationToSlack(reservation, "endedEarly", boothName, "guest"),
  );
  return NextResponse.json({ ok: true, reservation });
}
