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
import {
  RESERVATION_STATUSES,
  MAX_NOTE,
  type ReservationStatus,
} from "@/lib/types";
import { requireAdmin } from "@/lib/api-auth";
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
  minutesOfDay,
  durationMinutes,
  toDateTime,
  nowDateTime,
  epochMsOf,
} from "@/lib/datetime";
import { createCancelToken } from "@/lib/auth";
import { sendReservationEmail } from "@/lib/email";
import { postReservationToSlack } from "@/lib/slack";
import {
  approvalRequiredFor,
  meetsMinDuration,
  noteRequiredFor,
  runTotalMinutes,
} from "@/lib/reservation-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Anyone can reserve a booth slot: no account, so the body carries the identity. */
export async function POST(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  // Public endpoint, so throttle per IP before doing any work.
  const ip = clientKey(req.headers);
  const gate = checkBookingBlocked(ip);
  if (gate.blocked) {
    return NextResponse.json(
      { ok: false, error: "Too many reservations from here. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(gate.retryAfterSeconds) },
      },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const boothId = typeof body.boothId === "string" ? body.boothId : "";
  const date = typeof body.date === "string" ? body.date : "";
  const start = typeof body.start === "string" ? body.start : "";
  const end = typeof body.end === "string" ? body.end : "";
  const note =
    typeof body.note === "string" ? body.note.trim() || undefined : undefined;

  // Who's booking. Same validator the form runs, so the messages match exactly.
  const guest = validateGuest(body);
  if (!guest.ok) {
    return NextResponse.json(
      { ok: false, error: guest.error, field: guest.field },
      { status: 400 },
    );
  }

  if (!isBoothId(boothId)) {
    return NextResponse.json(
      { ok: false, error: "Please choose a booth." },
      { status: 400 },
    );
  }
  if (!isReservableDate(date)) {
    return NextResponse.json(
      { ok: false, error: "That date can't be reserved." },
      { status: 400 },
    );
  }

  const startsAt = toDateTime(date, start);
  const endsAt = toDateTime(date, end);
  const startMin = minutesOfDay(startsAt);
  const endMin = minutesOfDay(endsAt);

  // Both ends must be real times on the step grid, inside the open window.
  if (
    !/^\d{2}:\d{2}$/.test(start) ||
    !/^\d{2}:\d{2}$/.test(end) ||
    !isValidTimeOfDay(startMin) ||
    !isValidTimeOfDay(endMin)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Please choose times within opening hours, in ${stepMinutes()}-minute steps.`,
      },
      { status: 400 },
    );
  }
  if (endMin <= startMin) {
    return NextResponse.json(
      { ok: false, error: "The end time must be after the start time." },
      { status: 400 },
    );
  }
  if (
    !meetsMinDuration(
      durationMinutes(startsAt, endsAt),
      minReservationMinutes(),
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Reservations must be at least ${minReservationMinutes()} minutes long.`,
      },
      { status: 400 },
    );
  }
  if (startsAt <= nowDateTime()) {
    return NextResponse.json(
      { ok: false, error: "That time has already passed." },
      { status: 400 },
    );
  }
  // The limits apply to a back-to-back run, or a split stay would dodge them.
  const held = heldRangesForEmail(guest.guest.email, date).map((h) => ({
    start: minutesOfDay(h.startsAt),
    end: minutesOfDay(h.endsAt),
  }));
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

  // Over the limit needs admin approval, counting the whole run for the same reason.
  const status = approvalRequiredFor(runMinutes, autoApproveMaxHours())
    ? "pending"
    : "confirmed";

  // Last gate before a write, so a bad request never spends its token.
  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return NextResponse.json(
      {
        ok: false,
        error: "We couldn't verify that you're human. Please reload and retry.",
      },
      { status: 403 },
    );
  }

  // Does the domain take mail? Before the insert, so a dead address holds nothing.
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

    // A booking counts once the confirmation is away; "skipped" is not a refusal.
    if (reservation.email) {
      const outcome = await sendReservationEmail(reservation, status);
      if (outcome === "failed") {
        discardReservation(reservation.id);
        return NextResponse.json(
          {
            ok: false,
            error:
              "We couldn't send the confirmation to that address, so nothing was reserved. Please check it and try again.",
          },
          { status: 502 },
        );
      }
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
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 409 },
      );
    }
    console.error("[reservations] POST failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not create the reservation." },
      { status: 400 },
    );
  }
}

const VALID_FILTERS: readonly string[] = ["all", ...RESERVATION_STATUSES];

/** Admin-only: the dashboard list. Nobody else can read who booked what. */
export async function GET(req: NextRequest) {
  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const sp = req.nextUrl.searchParams;
  const filterParam = sp.get("status") ?? "all";
  const filter = (VALID_FILTERS.includes(filterParam) ? filterParam : "all") as
    "all" | ReservationStatus;

  const page = queryReservations({
    filter,
    search: sp.get("q") ?? "",
    page: Number(sp.get("page")) || 1,
    pageSize: Number(sp.get("pageSize")) || 25,
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
    return NextResponse.json(
      { ok: false, error: "Expected { ids: string[] }." },
      { status: 400 },
    );
  }

  const removed = deleteReservations(ids as string[]);
  return NextResponse.json({ ok: true, removed });
}
