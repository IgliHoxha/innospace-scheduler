import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { reservedRanges } from "@/lib/db";
import { isBoothId } from "@/lib/booths";
import {
  isReservableDate,
  rangeLabel,
  openHour,
  closeHour,
} from "@/lib/schedule";
import { timeOf, todayYMD, nowDateTime, maxTime } from "@/lib/datetime";
import { pad2 } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What's already taken for a booth on a day, so the reservation screen can show it
 * and pre-empt a clash. `earliest` is the first time still reservable that day.
 */
export async function GET(req: NextRequest) {
  const session = requireSession(req);
  if (session instanceof NextResponse) return session;

  const sp = req.nextUrl.searchParams;
  const boothId = sp.get("booth") ?? "";
  const date = sp.get("date") ?? "";

  if (!isBoothId(boothId)) {
    return NextResponse.json(
      { ok: false, error: "Unknown booth." },
      { status: 400 },
    );
  }
  if (!isReservableDate(date)) {
    return NextResponse.json(
      { ok: false, error: "Date is outside the reservation window." },
      { status: 400 },
    );
  }

  const reserved = (await reservedRanges(boothId, date)).map((b) => ({
    start: timeOf(b.startsAt),
    end: timeOf(b.endsAt),
    label: rangeLabel(b.startsAt, b.endsAt),
    // Members share the booths, so they can see who holds a slot: the name
    // only, never the note or the contact details.
    by: b.reservedBy,
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
    reserved,
    earliest,
    opens,
    closes: `${pad2(closeHour())}:00`,
  });
}
