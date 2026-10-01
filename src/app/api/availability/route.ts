import { NextRequest, NextResponse } from "next/server";
import { reservationCountsByBooth, reservedRanges } from "@/lib/db";
import { getBooths, isBoothId } from "@/lib/booths";
import { ceilToStep, isReservableDate, rangeLabel } from "@/lib/schedule";
import {
  timeOf,
  todayYMD,
  nowDateTime,
  minutesOfDay,
  minutesToTime,
} from "@/lib/datetime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What's taken for a booth on a day, every booth's count, and the first reservable time. Public. */
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

  // Times only: the board says a slot is taken, never who by.
  const reserved = reservedRanges(boothId, date).map((b) => ({
    start: timeOf(b.startsAt),
    end: timeOf(b.endsAt),
    label: rangeLabel(b.startsAt, b.endsAt),
  }));

  // Every configured booth and no other, so a card never guesses and a retired id never leaks.
  const taken = reservationCountsByBooth(date);
  const counts = Object.fromEntries(
    getBooths().map((b) => [b.id, taken.get(b.id) ?? 0]),
  );

  // Today, anything past is gone, rounded onto the grid the picker seeds from.
  const earliest =
    date === todayYMD()
      ? minutesToTime(ceilToStep(minutesOfDay(nowDateTime())))
      : "00:00";

  return NextResponse.json({
    ok: true,
    booth: boothId,
    date,
    reserved,
    counts,
    earliest,
  });
}
