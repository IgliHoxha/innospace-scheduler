import { NextRequest, NextResponse } from "next/server";
import {
  createReservation,
  queryReservations,
  deleteReservations,
  SlotUnavailableError,
} from "@/lib/db";
import { RESERVATION_STATUSES, MAX_NOTE } from "@/lib/types";
import type { ReservationStatus } from "@/lib/types";
import { requireSession, requireAdmin } from "@/lib/api-auth";
import { requireAllowedOrigin } from "@/lib/cors";
import { boothName, isBoothId } from "@/lib/booths";
import {
  isReservableDate,
  needsApproval,
  noteRequired,
  autoApproveMaxHours,
  isValidTimeOfDay,
  minReservationMinutes,
  minutesOfDay,
  durationMinutes,
  toDateTime,
  nowDateTime,
  stepMinutes,
} from "@/lib/schedule";
import { sendReservationEmail } from "@/lib/email";
import { meetsMinDuration } from "@/lib/reservation-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Members reserve a booth slot. Identity comes from the session, not the body. */
export async function POST(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const session = requireSession(req);
  if (session instanceof NextResponse) return session;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const boothId = typeof body.boothId === "string" ? body.boothId : "";
  const date = typeof body.date === "string" ? body.date : "";
  const start = typeof body.start === "string" ? body.start : "";
  const end = typeof body.end === "string" ? body.end : "";
  const note =
    typeof body.note === "string" ? body.note.trim() || undefined : undefined;

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
  if (noteRequired(startsAt, endsAt) && !note) {
    return NextResponse.json(
      {
        ok: false,
        error: `Please add a note saying what the reservation is for - it's required for reservations of ${autoApproveMaxHours()} hours or more.`,
      },
      { status: 400 },
    );
  }
  if (note && note.length > MAX_NOTE) {
    return NextResponse.json(
      { ok: false, error: `The note must be ${MAX_NOTE} characters or fewer.` },
      { status: 400 },
    );
  }

  // Reservations over the limit need admin approval; shorter ones confirm instantly.
  const status = needsApproval(startsAt, endsAt) ? "pending" : "confirmed";

  try {
    const reservation = await createReservation(
      {
        boothId,
        startsAt,
        endsAt,
        note,
        fullName: session.name,
        email: session.email,
        userId: session.sub,
      },
      status,
    );

    // Email the member: confirmation, or a "request received" note if pending.
    // Never block the response on email.
    if (reservation.email) {
      try {
        await sendReservationEmail(reservation, status);
      } catch (err) {
        console.error("[reservations] confirmation email failed:", err);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        id: reservation.id,
        reservation,
        booth: boothName(boothId),
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
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

/**
 * List reservations. Admin sees everything; a member is scoped to their own
 * reservations (their "my reservations" list).
 */
export async function GET(req: NextRequest) {
  const session = requireSession(req);
  if (session instanceof NextResponse) return session;

  const sp = req.nextUrl.searchParams;
  const filterParam = sp.get("status") ?? "all";
  const filter = (VALID_FILTERS.includes(filterParam) ? filterParam : "all") as
    "all" | ReservationStatus;

  const page = await queryReservations({
    filter,
    search: sp.get("q") ?? "",
    page: Number(sp.get("page")) || 1,
    pageSize: Number(sp.get("pageSize")) || 25,
    userId: session.role === "admin" ? undefined : session.sub,
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

  const removed = await deleteReservations(ids as string[]);
  return NextResponse.json({ ok: true, removed });
}
