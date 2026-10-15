import { NextRequest, NextResponse } from "next/server";
import {
  createReservationSeries,
  discardReservation,
  heldRangesForEmail,
  queryReservations,
  deleteReservations,
  SlotUnavailableError,
  UserBusyError,
} from "@/lib/db";
import {
  isReservationStatus,
  MAX_NAME,
  MAX_NOTE,
  type ActiveStatus,
  type Reservation,
} from "@/lib/types";
import { PAGE_SIZE } from "@/lib/pagination";
import { memberFrom, requireAdmin } from "@/lib/api-auth";
import { jsonBody } from "@/lib/api-request";
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
import { createCancelToken, createSeriesCancelToken } from "@/lib/auth";
import { sendReservationEmail } from "@/lib/email";
import {
  parseRepeatWeeks,
  REPEAT_SIGN_IN_MESSAGE,
  repeatWeeksMessage,
  weeklyDates,
} from "@/lib/recurrence";
import { postReservationToSlack } from "@/lib/slack";
import { notifyNewReservation } from "@/lib/telegram";
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

/** Signed in or not: a guest's body carries the identity, a member's session does. */
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

  const body = await jsonBody(req);
  const boothId = typeof body.boothId === "string" ? body.boothId : "";
  const date = typeof body.date === "string" ? body.date : "";
  const start = typeof body.start === "string" ? body.start : "";
  const end = typeof body.end === "string" ? body.end : "";
  const note =
    typeof body.note === "string" ? body.note.trim() || undefined : undefined;

  // Google already verified a member, so the body cannot rename them.
  const member = memberFrom(req);
  let identity: { fullName: string; email: string };
  if (member) {
    identity = {
      fullName: member.name.trim().slice(0, MAX_NAME) || member.email,
      email: member.email.toLowerCase(),
    };
  } else {
    // The same validator the form runs, so the messages match exactly.
    const guest = validateGuest(body);
    if (!guest.ok) {
      return NextResponse.json(
        { ok: false, error: guest.error, field: guest.field },
        { status: 400 },
      );
    }
    identity = guest.guest;
  }

  const repeatWeeks = parseRepeatWeeks(body.repeatWeeks);
  if (repeatWeeks === null) return jsonError(repeatWeeksMessage(), 400);
  // A repeat needs someone to come back to, which a guest session is not.
  if (repeatWeeks > 1 && !member) return jsonError(REPEAT_SIGN_IN_MESSAGE, 401);

  if (!isBoothId(boothId)) {
    return jsonError("Please choose a booth.", 400);
  }
  // The window gates the first date; the repeats are the point of a series.
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
    heldRangesForEmail(identity.email, day).map((h) => ({
      start: minutesOfDay(h.startsAt) + offsetMin,
      end: minutesOfDay(h.endsAt) + offsetMin,
    }));
  // Shifted by the last bookable minute, not 24h, so the dead step is no gap.
  const dayReach = dayEndMinute(stepMinutes());
  // No closing time, so a run can cross midnight and both neighbours count.
  const runOn = (day: string) => {
    const held = [
      ...heldOn(shiftDate(day, -1), -dayReach),
      ...heldOn(day, 0),
      ...heldOn(shiftDate(day, 1), dayReach),
    ];
    // One sitting spans the shortest bookable gap: nobody could take it.
    return runTotalMinutes(startMin, endMin, held, minReservationMinutes());
  };
  // Each date is judged on its own day, since a run is what sits around it.
  const dates = weeklyDates(date, repeatWeeks);
  const runs = dates.map(runOn);
  const runMinutes = Math.max(...runs);
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

  // Judged per date: one date next to an earlier booking can need approval alone.
  const statusFor = (run: number): ActiveStatus =>
    approvalRequiredFor(run, autoApproveMaxHours()) ? "pending" : "confirmed";
  const statuses = runs.map(statusFor);
  // The email speaks for the whole series, so one held date makes it pending.
  const status: ActiveStatus = statuses.includes("pending")
    ? "pending"
    : "confirmed";

  // Last gate before a write, so a bad request never spends its token.
  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return jsonError(
      "We couldn't verify that you're human. Please reload and retry.",
      403,
    );
  }

  // Before the insert, so a dead address holds nothing; Google's is verified.
  if (!member) {
    const deliverable = await checkEmailDeliverable(identity.email);
    if (!deliverable.ok) {
      return NextResponse.json(
        { ok: false, field: "email", error: deliverable.error },
        { status: 400 },
      );
    }
  }

  // Count it once the request is good, so a typo'd form doesn't burn the quota.
  registerBooking(ip);

  try {
    const reservations = createReservationSeries(
      dates.map((day, i) => ({
        input: {
          boothId,
          startsAt: toDateTime(day, start),
          endsAt: toDateTime(day, end),
          note,
          ...identity,
        },
        status: statuses[i],
      })),
    );
    const reservation = reservations[0];

    // A booking counts once the confirmation is away; "skipped" is no refusal.
    const outcome = await sendReservationEmail(
      reservation,
      status,
      undefined,
      reservations,
    );
    if (outcome === "failed") {
      reservations.forEach((r) => discardReservation(r.id));
      return jsonError(
        "We couldn't send the confirmation to that address, so nothing was reserved. Please check it and try again.",
        502,
      );
    }

    // After the email, so the channel never announces a discarded booking.
    for (const r of reservations) {
      await postReservationToSlack(r, r.status as ActiveStatus, boothName);
      await notifyNewReservation(r, boothName);
    }

    // The proof the email link carries, so this browser can cancel without it.
    const tokenFor = (r: Reservation): string | undefined => {
      const expiresAt = epochMsOf(r.endsAt ?? endsAt);
      return Number.isFinite(expiresAt)
        ? createCancelToken(r.id, expiresAt)
        : undefined;
    };
    const last = reservations[reservations.length - 1];
    const seriesEnd = epochMsOf(last.endsAt ?? endsAt);
    return NextResponse.json(
      {
        ok: true,
        id: reservation.id,
        reservation,
        reservations: reservations.map((r) => ({
          ...r,
          cancelToken: tokenFor(r),
        })),
        booth: boothName(boothId),
        cancelToken: tokenFor(reservation),
        seriesCancelToken:
          reservation.seriesId && Number.isFinite(seriesEnd)
            ? createSeriesCancelToken(reservation.seriesId, seriesEnd)
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

  const { ids } = await jsonBody(req);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return jsonError("Expected { ids: string[] }.", 400);
  }

  const removed = deleteReservations(ids as string[]);
  return NextResponse.json({ ok: true, removed });
}
