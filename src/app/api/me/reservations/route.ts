import { NextRequest, NextResponse } from "next/server";
import { memberFrom } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-response";
import { reservationsForEmail } from "@/lib/db";
import { boothName } from "@/lib/booths";
import { nowDateTime } from "@/lib/datetime";
import { minReservationMinutes, stepMinutes } from "@/lib/schedule";
import { phaseOf, type MyBooking } from "@/lib/my-bookings";
import type { Reservation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Enough history to recognise, without the list growing for ever.
const PAST_LIMIT = 20;

const NO_STORE = { "Cache-Control": "private, no-store" };

function toMyBooking(r: Reservation, now: string): MyBooking {
  const startsAt = r.startsAt ?? "";
  const endsAt = r.endsAt ?? "";
  return {
    id: r.id,
    boothName: boothName(r.boothId),
    startsAt,
    endsAt,
    status: r.status,
    phase: phaseOf(startsAt, endsAt, now),
    createdAt: r.createdAt,
    ...(r.note?.trim() ? { note: r.note.trim() } : {}),
  };
}

/** A member's own bookings, with the server's clock so the dialog sorts them as the routes will judge them. */
export async function GET(req: NextRequest) {
  const member = memberFrom(req);
  if (!member) return jsonError("Please sign in first.", 401, NO_STORE);

  const now = nowDateTime();
  const { current, past } = reservationsForEmail(member.email, now, PAST_LIMIT);
  return NextResponse.json(
    {
      ok: true,
      now,
      stepMinutes: stepMinutes(),
      minMinutes: minReservationMinutes(),
      bookings: [...current, ...past].map((r) => toMyBooking(r, now)),
    },
    { headers: NO_STORE },
  );
}
