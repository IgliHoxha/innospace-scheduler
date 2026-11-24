import { NextRequest, NextResponse, after } from "next/server";
import {
  createReservationSeries,
  discardReservation,
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
import { memberFrom, requireAdmin, type Member } from "@/lib/api-auth";
import { jsonBody } from "@/lib/api-request";
import { jsonError } from "@/lib/api-response";
import { requireAllowedOrigin } from "@/lib/cors";
import { validateGuest, type GuestResult } from "@/lib/guest";
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
import { runMinutesOn } from "@/lib/booking-run";
import {
  isDateTime,
  minutesOfDay,
  durationMinutes,
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
  END_BEFORE_START_MESSAGE,
  meetsMinDuration,
  noteRequiredFor,
  offGridMessage,
  TIME_PASSED_MESSAGE,
  tooShortMessage,
} from "@/lib/reservation-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A member is named by their verified session; a guest only by the body. */
function bookerFrom(
  member: Member | null,
  body: Record<string, unknown>,
): GuestResult {
  if (!member) return validateGuest(body);
  return {
    ok: true,
    guest: {
      fullName: member.name.trim().slice(0, MAX_NAME) || member.email,
      email: member.email.toLowerCase(),
    },
  };
}

/** Why these times cannot be booked, empty when they can; any hour of the day is open. */
function timesProblem(startsAt: string, endsAt: string): string {
  const startMin = minutesOfDay(startsAt);
  const endMin = minutesOfDay(endsAt);
  const onGrid =
    isDateTime(startsAt) &&
    isDateTime(endsAt) &&
    isValidTimeOfDay(startMin) &&
    isValidTimeOfDay(endMin);
  if (!onGrid) return offGridMessage(stepMinutes());
  if (endMin <= startMin) return END_BEFORE_START_MESSAGE;
  const minutes = durationMinutes(startsAt, endsAt);
  if (!meetsMinDuration(minutes, minReservationMinutes()))
    return tooShortMessage(minReservationMinutes());
  if (startsAt <= nowDateTime()) return TIME_PASSED_MESSAGE;
  return "";
}

/** What is wrong with the note for a run this long, empty when nothing is. */
function noteProblem(
  note: string | undefined,
  runMinutes: number,
  partOfRun: boolean,
): string {
  const hours = autoApproveMaxHours();
  if (noteRequiredFor(runMinutes, hours) && !note) {
    return partOfRun
      ? `Please add a note saying what the reservation is for - back to back with your other bookings this comes to ${hours} hours or more.`
      : `Please add a note saying what the reservation is for - it's required for reservations of ${hours} hours or more.`;
  }
  if (note && note.length > MAX_NOTE)
    return `The note must be ${MAX_NOTE} characters or fewer.`;
  return "";
}

/** The 201: each date with its cancel proof, so this browser can cancel too. */
function bookedResponse(
  reservations: Reservation[],
  boothId: string,
  endsAt: string,
): NextResponse {
  const reservation = reservations[0];
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
}

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

  const member = memberFrom(req);
  const who = bookerFrom(member, body);
  if (!who.ok) {
    return NextResponse.json(
      { ok: false, error: who.error, field: who.field },
      { status: 400 },
    );
  }
  const identity = who.guest;

  const repeatWeeks = parseRepeatWeeks(body.repeatWeeks);
  if (repeatWeeks === null) return jsonError(repeatWeeksMessage(), 400);
  if (repeatWeeks > 1 && !member) return jsonError(REPEAT_SIGN_IN_MESSAGE, 401);

  if (!isBoothId(boothId)) {
    return jsonError("Please choose a booth.", 400);
  }
  // Only the first date must fall in the window; later repeats may run past it.
  if (!isReservableDate(date)) {
    return jsonError("That date can't be reserved.", 400);
  }

  const startsAt = toDateTime(date, start);
  const endsAt = toDateTime(date, end);
  const badTimes = timesProblem(startsAt, endsAt);
  if (badTimes) return jsonError(badTimes, 400);

  const startMin = minutesOfDay(startsAt);
  const endMin = minutesOfDay(endsAt);
  const dates = weeklyDates(date, repeatWeeks);
  const runs = runMinutesOn(dates, identity.email, startMin, endMin);
  const runMinutes = Math.max(...runs);

  const badNote = noteProblem(note, runMinutes, runMinutes > endMin - startMin);
  if (badNote) {
    return NextResponse.json(
      // Named so the form lands the cursor on the note, not a message below.
      { ok: false, field: "note", error: badNote },
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

  // In parallel: the token is single-use anyway, and Google vouches for a member.
  const [human, deliverable] = member
    ? [true, { ok: true } as const]
    : await Promise.all([
        verifyTurnstile(body.turnstileToken, ip),
        checkEmailDeliverable(identity.email),
      ]);

  // The bot check answers first, so a bot learns nothing about the address.
  if (!human) {
    return jsonError(
      "We couldn't verify that you're human. Please reload and retry.",
      403,
    );
  }

  // Before the insert, so a dead address holds nothing.
  if (!deliverable.ok) {
    return NextResponse.json(
      { ok: false, field: "email", error: deliverable.error },
      { status: 400 },
    );
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

    // A booking counts once the confirmation is away; "skipped" is no refusal.
    const outcome = await sendReservationEmail(
      reservations[0],
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

    // After the email and the response: nothing discarded is announced, nobody waits.
    after(async () => {
      for (const r of reservations) {
        await postReservationToSlack(r, r.status as ActiveStatus, boothName);
        await notifyNewReservation(r, boothName);
      }
    });

    return bookedResponse(reservations, boothId, endsAt);
  } catch (err) {
    if (err instanceof SlotUnavailableError || err instanceof UserBusyError) {
      return jsonError(err.message, 409);
    }
    console.error("[reservations] POST failed:", err);
    return jsonError("Could not create the reservation.", 400);
  }
}

/** Admin-only, since the list names every booker. */
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
