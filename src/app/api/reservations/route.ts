import { NextRequest, NextResponse } from "next/server";
import {
  createReservation,
  discardReservation,
  heldRangesForEmail,
  queryReservations,
  deleteReservations,
  SlotUnavailableError,
  UserBusyError,
} from "@/lib/db";
import { isReservationStatus, MAX_NOTE } from "@/lib/types";
import { PAGE_SIZE } from "@/lib/pagination";
import { requireAdmin } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-response";
import { requireAllowedOrigin } from "@/lib/cors";
import { validateGuest } from "@/lib/guest";
import { verifyTurnstile } from "@/lib/turnstile";
import { checkEmailDeliverable } from "@/lib/email-verify";
import {
  checkBookingBlocked,
  clientKey,
  registerBooking,
} from "@/lib/rate-limit";
import { boothName, isBoothId } from "@/lib/booths";
import {
  isReservableDate,
  autoApproveMaxHours,
  isValidTimeOfDay,
  minReservationMinutes,
  stepMinutes,
} from "@/lib/schedule";
import {
  isDateTime,
  minutesOfDay,
  durationMinutes,
  shiftDate,
  toDateTime,
  nowDateTime,
  epochMsOf,
} from "@/lib/datetime";
import { createCancelToken } from "@/lib/auth";
import { sendReservationEmail } from "@/lib/email";
import { postReservationToSlack } from "@/lib/slack";
import {
  approvalRequiredFor,
  dayEndMinute,
  END_BEFORE_START_MESSAGE,
  meetsMinDuration,
  noteRequiredFor,
  offGridMessage,
  runTotalMinutes,
  TIME_PASSED_MESSAGE,
  tooShortMessage,
} from "@/lib/reservation-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: no account, so the body carries the identity. */
export async function POST(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  // Public endpoint, so throttle per IP before doing any work.
  const ip = clientKey(req.headers);
  const gate = checkBookingBlocked(ip);
  if (gate.blocked) {
    return jsonError("Too many reservations from here. Try again later.", 429, {
      "Retry-After": String(gate.retryAfterSeconds),
    });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const boothId = typeof body.boothId === "string" ? body.boothId : "";
  const date = typeof body.date === "string" ? body.date : "";
  const start = typeof body.start === "string" ? body.start : "";
  const end = typeof body.end === "string" ? body.end : "";
  const note =
    typeof body.note === "string" ? body.note.trim() || undefined : undefined;

  // The same validator the form runs, so the messages match exactly.
  const guest = validateGuest(body);
  if (!guest.ok) {
    return NextResponse.json(
      { ok: false, error: guest.error, field: guest.field },
      { status: 400 },
    );
  }

  if (!isBoothId(boothId)) {
    return jsonError("Please choose a booth.", 400);
  }
  if (!isReservableDate(date)) {
    return jsonError("That date can't be reserved.", 400);
  }

  const startsAt = toDateTime(date, start);
  const endsAt = toDateTime(date, end);
  const startMin = minutesOfDay(startsAt);
  const endMin = minutesOfDay(endsAt);

  // Real clock times on the step grid; any hour of the day is open.
  if (
    !isDateTime(startsAt) ||
    !isDateTime(endsAt) ||
    !isValidTimeOfDay(startMin) ||
    !isValidTimeOfDay(endMin)
  ) {
    return jsonError(offGridMessage(stepMinutes()), 400);
  }
  if (endMin <= startMin) {
    return jsonError(END_BEFORE_START_MESSAGE, 400);
  }
  if (
    !meetsMinDuration(
      durationMinutes(startsAt, endsAt),
      minReservationMinutes(),
    )
  ) {
    return jsonError(tooShortMessage(minReservationMinutes()), 400);
  }
  if (startsAt <= nowDateTime()) {
    return jsonError(TIME_PASSED_MESSAGE, 400);
  }
  // The limits apply to a back-to-back run, or a split stay would dodge them.
  const heldOn = (day: string, offsetMin: number) =>
    heldRangesForEmail(guest.guest.email, day).map((h) => ({
      start: minutesOfDay(h.startsAt) + offsetMin,
      end: minutesOfDay(h.endsAt) + offsetMin,
    }));
  // Shifted by the last bookable minute, not 24h, so the dead step is no gap.
  const dayReach = dayEndMinute(stepMinutes());
  // No closing time, so a run can cross midnight and both neighbours count.
  const held = [
    ...heldOn(shiftDate(date, -1), -dayReach),
    ...heldOn(date, 0),
    ...heldOn(shiftDate(date, 1), dayReach),
  ];
  // One sitting spans the shortest bookable gap: nobody could take it.
  const runMinutes = runTotalMinutes(
    startMin,
    endMin,
    held,
    minReservationMinutes(),
  );
  const partOfRun = runMinutes > endMin - startMin;

  if (noteRequiredFor(runMinutes, autoApproveMaxHours()) && !note) {
    return NextResponse.json(
      {
        ok: false,
        // Named so the form lands the cursor on the note, not a message below.
        field: "note",
        error: partOfRun
          ? `Please add a note saying what the reservation is for - back to back with your other bookings this comes to ${autoApproveMaxHours()} hours or more.`
          : `Please add a note saying what the reservation is for - it's required for reservations of ${autoApproveMaxHours()} hours or more.`,
      },
      { status: 400 },
    );
  }
  if (note && note.length > MAX_NOTE) {
    return NextResponse.json(
      {
        ok: false,
        field: "note",
        error: `The note must be ${MAX_NOTE} characters or fewer.`,
      },
      { status: 400 },
    );
  }

  const status = approvalRequiredFor(runMinutes, autoApproveMaxHours())
    ? "pending"
    : "confirmed";

  // Last gate before a write, so a bad request never spends its token.
  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return jsonError(
      "We couldn't verify that you're human. Please reload and retry.",
      403,
    );
  }

  // Before the insert, so a dead address holds nothing.
  const deliverable = await checkEmailDeliverable(guest.guest.email);
  if (!deliverable.ok) {
    return NextResponse.json(
      { ok: false, field: "email", error: deliverable.error },
      { status: 400 },
    );
  }

  // Count it once the request is good, so a typo'd form doesn't burn the quota.
  registerBooking(ip);

  try {
    const reservation = createReservation(
      {
        boothId,
        startsAt,
        endsAt,
        note,
        ...guest.guest,
      },
      status,
    );

    // A booking counts once the confirmation is away; "skipped" is no refusal.
    const outcome = await sendReservationEmail(reservation, status);
    if (outcome === "failed") {
      discardReservation(reservation.id);
      return jsonError(
        "We couldn't send the confirmation to that address, so nothing was reserved. Please check it and try again.",
        502,
      );
    }

    // After the email, so the channel never announces a discarded booking.
    await postReservationToSlack(reservation, status, boothName);

    // The proof the email link carries, so this browser can cancel without it.
    const expiresAt = epochMsOf(reservation.endsAt ?? endsAt);
    return NextResponse.json(
      {
        ok: true,
        id: reservation.id,
        reservation,
        booth: boothName(boothId),
        cancelToken: Number.isFinite(expiresAt)
          ? createCancelToken(reservation.id, expiresAt)
          : undefined,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof SlotUnavailableError || err instanceof UserBusyError) {
      return jsonError(err.message, 409);
    }
    console.error("[reservations] POST failed:", err);
    return jsonError("Could not create the reservation.", 400);
  }
}

/** Admin-only: the dashboard list. Nobody else can read who booked what. */
export async function GET(req: NextRequest) {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const sp = req.nextUrl.searchParams;
  const filterParam = sp.get("status") ?? "all";
  const filter = isReservationStatus(filterParam) ? filterParam : "all";

  const page = queryReservations({
    filter,
    search: sp.get("q") ?? "",
    page: Number(sp.get("page")) || 1,
    pageSize: Number(sp.get("pageSize")) || PAGE_SIZE,
    // Opt out, so an unaware caller still gets the tallies it expects.
    withCounts: sp.get("counts") !== "0",
  });

  return NextResponse.json({ ok: true, ...page });
}

/** Admin-only: permanently remove soft-deleted reservations. */
export async function DELETE(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const { ids } = (await req.json().catch(() => ({}))) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return jsonError("Expected { ids: string[] }.", 400);
  }

  const removed = deleteReservations(ids as string[]);
  return NextResponse.json({ ok: true, removed });
}
