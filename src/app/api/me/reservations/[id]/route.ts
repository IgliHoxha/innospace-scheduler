import { NextRequest, NextResponse, after } from "next/server";
import { memberFrom, type Member } from "@/lib/api-auth";
import { jsonBody } from "@/lib/api-request";
import { jsonError } from "@/lib/api-response";
import { requireAllowedOrigin } from "@/lib/cors";
import {
  getReservation,
  SlotUnavailableError,
  updateReservationEnd,
  updateReservationStatus,
  UserBusyError,
} from "@/lib/db";
import { canonicalEmail } from "@/lib/guest";
import { boothName } from "@/lib/booths";
import { runMinutesOn } from "@/lib/booking-run";
import { postReservationToSlack } from "@/lib/slack";
import { dateOf, minutesOfDay, nowDateTime, toDateTime } from "@/lib/datetime";
import {
  autoApproveMaxHours,
  isValidTimeOfDay,
  minReservationMinutes,
  stepMinutes,
} from "@/lib/schedule";
import {
  approvalRequiredFor,
  END_BEFORE_START_MESSAGE,
  meetsMinDuration,
  noteRequiredFor,
  offGridMessage,
  tooShortMessage,
} from "@/lib/reservation-rules";
import {
  CANCEL_STARTED_MESSAGE,
  END_NOT_LATER_MESSAGE,
  END_ONLY_ONGOING_MESSAGE,
  longStayMessage,
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

/** Cancels a booking that has not started yet. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const member = guard(req);
  if (member instanceof NextResponse) return member;

  const existing = ownBooking(member, (await params).id);
  if (!existing) return jsonError(NOT_FOUND_MESSAGE, 404);
  if (!isActiveStatus(existing.status)) {
    return jsonError(NOT_ACTIVE_MESSAGE, 409);
  }
  if (
    phaseOf(existing.startsAt!, existing.endsAt!, nowDateTime()) !== "upcoming"
  ) {
    return jsonError(CANCEL_STARTED_MESSAGE, 400);
  }

  const reservation = updateReservationStatus(existing.id, "cancelled");
  if (!reservation) return jsonError(NOT_FOUND_MESSAGE, 404);

  // No email: their own action, as with the emailed cancel link.
  after(() =>
    postReservationToSlack(reservation, "cancelled", boothName, "guest"),
  );
  return NextResponse.json({ ok: true, reservation });
}

/** Moves the end of a booking under way; shortening is always fine, extending obeys the booking rules. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const member = guard(req);
  if (member instanceof NextResponse) return member;

  const existing = ownBooking(member, (await params).id);
  if (!existing) return jsonError(NOT_FOUND_MESSAGE, 404);
  if (!isActiveStatus(existing.status)) {
    return jsonError(NOT_ACTIVE_MESSAGE, 409);
  }

  const now = nowDateTime();
  const startsAt = existing.startsAt!;
  const oldEndsAt = existing.endsAt!;
  if (phaseOf(startsAt, oldEndsAt, now) !== "ongoing") {
    return jsonError(END_ONLY_ONGOING_MESSAGE, 400);
  }

  const { end } = await jsonBody(req);
  const endsAt =
    typeof end === "string" && /^\d{2}:\d{2}$/.test(end)
      ? toDateTime(dateOf(startsAt), end)
      : "";
  const startMin = minutesOfDay(startsAt);
  const endMin = endsAt ? minutesOfDay(endsAt) : NaN;
  if (!endsAt || !isValidTimeOfDay(endMin)) {
    return jsonError(offGridMessage(stepMinutes()), 400);
  }
  if (endMin <= startMin) return jsonError(END_BEFORE_START_MESSAGE, 400);
  if (!meetsMinDuration(endMin - startMin, minReservationMinutes())) {
    return jsonError(tooShortMessage(minReservationMinutes()), 400);
  }
  if (endsAt <= now) return jsonError(END_NOT_LATER_MESSAGE, 400);
  if (endsAt === oldEndsAt) {
    return NextResponse.json({ ok: true, reservation: existing });
  }

  // Only a longer stay can cross a limit; one already past it may still shrink.
  if (endsAt > oldEndsAt) {
    const hours = autoApproveMaxHours();
    const [run] = runMinutesOn(
      [dateOf(startsAt)],
      existing.email!,
      startMin,
      endMin,
    );
    if (approvalRequiredFor(run, hours) && existing.status === "confirmed") {
      return jsonError(longStayMessage(hours, true), 400);
    }
    if (noteRequiredFor(run, hours) && !existing.note?.trim()) {
      return jsonError(longStayMessage(hours, false), 400);
    }
  }

  try {
    const reservation = updateReservationEnd(existing.id, endsAt);
    if (!reservation) return jsonError(NOT_ACTIVE_MESSAGE, 409);
    after(() =>
      postReservationToSlack(reservation, "endChanged", boothName, "guest"),
    );
    return NextResponse.json({ ok: true, reservation });
  } catch (err) {
    if (err instanceof SlotUnavailableError || err instanceof UserBusyError) {
      return jsonError(err.message, 409);
    }
    throw err;
  }
}
