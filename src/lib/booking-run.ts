// Server-only: the run rule reads the DB, so the booking and the edit route share it.
import { heldRangesForEmail } from "./db";
import { minutesOfDay, shiftDate } from "./datetime";
import { dayEndMinute, runTotalMinutes } from "./reservation-rules";
import { minReservationMinutes, stepMinutes } from "./schedule";

/** The back-to-back run on each date, or a split stay would dodge the limits. */
export function runMinutesOn(
  dates: readonly string[],
  email: string,
  startMin: number,
  endMin: number,
): number[] {
  const heldOn = (day: string, offsetMin: number) =>
    heldRangesForEmail(email, day).map((h) => ({
      start: minutesOfDay(h.startsAt) + offsetMin,
      end: minutesOfDay(h.endsAt) + offsetMin,
    }));
  // Shifted by the last bookable minute, not 24h, so the dead step is no gap.
  const dayReach = dayEndMinute(stepMinutes());
  // Each date is judged on its own day, since a run is what sits around it.
  return dates.map((day) => {
    // No closing time, so a run can cross midnight and both neighbours count.
    const held = [
      ...heldOn(shiftDate(day, -1), -dayReach),
      ...heldOn(day, 0),
      ...heldOn(shiftDate(day, 1), dayReach),
    ];
    // One sitting spans the shortest bookable gap: nobody could take it.
    return runTotalMinutes(startMin, endMin, held, minReservationMinutes());
  });
}
