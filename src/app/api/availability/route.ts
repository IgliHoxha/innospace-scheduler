import { NextRequest, NextResponse } from "next/server";
import { reservedRanges } from "@/lib/db";
import { isBoothId } from "@/lib/booths";
import {
  ceilToStep,
  isReservableDate,
  rangeLabel,
  openHour,
  closeHour,
} from "@/lib/schedule";
import {
  timeOf,
  todayYMD,
  nowDateTime,
  minutesOfDay,
  minutesToTime,
} from "@/lib/datetime";
import { pad2 } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What's taken for a booth on a day, plus `earliest`, the first time still
 * reservable. Public, like the booking screen it feeds.
 */
export async function GET(req: NextRequest) {
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
    // Everyone shares the booths, so the board shows who holds a slot: the name
    // only, never the email, the note or anything else on the row.
    by: b.reservedBy,
  }));

  const opens = `${pad2(openHour())}:00`;
  // Today, anything before "now" is gone. Rounded onto the step grid because the
  // picker seeds from this, and 15:22 would seed a time nothing can reserve.
  const earliest =
    date === todayYMD()
      ? minutesToTime(
          Math.max(openHour() * 60, ceilToStep(minutesOfDay(nowDateTime()))),
        )
      : opens;

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
