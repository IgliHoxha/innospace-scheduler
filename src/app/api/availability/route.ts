import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { bookedRanges } from "@/lib/db";
import { isBoothId } from "@/lib/booths";
import {
  isBookableDate,
  todayYMD,
  nowDateTime,
  timeOf,
  rangeLabel,
  openHour,
  closeHour,
} from "@/lib/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * What's already taken for a booth on a day, so the booking screen can show it
 * and pre-empt a clash. `earliest` is the first time still bookable that day.
 */
export async function GET(req: NextRequest) {
  const session = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const boothId = sp.get("booth") ?? "";
  const date = sp.get("date") ?? "";

  if (!isBoothId(boothId)) {
    return NextResponse.json(
      { ok: false, error: "Unknown booth." },
      { status: 400 },
    );
  }
  if (!isBookableDate(date)) {
    return NextResponse.json(
      { ok: false, error: "Date is outside the booking window." },
      { status: 400 },
    );
  }

  const booked = (await bookedRanges(boothId, date)).map((b) => ({
    start: timeOf(b.startsAt),
    end: timeOf(b.endsAt),
    label: rangeLabel(b.startsAt, b.endsAt),
    // Members share the booths, so they can see who holds a slot: the name
    // only, never the note or the contact details.
    by: b.bookedBy,
    mine: !!b.userId && b.userId === session.sub,
  }));

  const opens = `${pad2(openHour())}:00`;
  // Today, anything before "now" is already gone.
  const earliest =
    date === todayYMD() ? maxTime(opens, timeOf(nowDateTime())) : opens;

  return NextResponse.json({
    ok: true,
    booth: boothId,
    date,
    booked,
    earliest,
    opens,
    closes: `${pad2(closeHour())}:00`,
  });
}

// "HH:MM" strings compare correctly as text.
function maxTime(a: string, b: string): string {
  return a >= b ? a : b;
}
