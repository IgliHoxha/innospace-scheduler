// Time rules; a reservation is local "YYYY-MM-DDTHH:MM" with no TZ, so TZ must match the space.
import {
  approvalRequiredFor,
  isBookableMinute,
  noteRequiredFor,
} from "./reservation-rules";
import { requireIntEnv } from "./env-app";
import { timeOf, durationMinutes, ymd } from "./datetime";

/** First reservable hour of the day, 24h. */
export function openHour(): number {
  return Math.min(23, Math.max(0, requireIntEnv("OPEN_HOUR")));
}

/** Closing hour: a reservation must end by this, and it always beats openHour(). */
export function closeHour(): number {
  return Math.min(24, Math.max(openHour() + 1, requireIntEnv("CLOSE_HOUR")));
}

/** How many days ahead, including today, can be reserved. */
export function reservationWindowDays(): number {
  return Math.max(0, requireIntEnv("RESERVATION_WINDOW_DAYS"));
}

/** Times snap to this many minutes (09:10 yes, 09:07 no). Must divide 60. */
export function stepMinutes(): number {
  const v = requireIntEnv("TIME_STEP_MINUTES");
  if (!(v > 0 && v <= 60 && 60 % v === 0)) {
    throw new Error(
      "TIME_STEP_MINUTES must divide 60 evenly (1/5/10/15/30/60).",
    );
  }
  return v;
}

/** Shortest reservable length in minutes, never below one step. */
export function minReservationMinutes(): number {
  return Math.max(stepMinutes(), requireIntEnv("MIN_RESERVATION_MINUTES"));
}

/** Longest reservation that auto-confirms; anything longer is created pending. */
export function autoApproveMaxHours(): number {
  return Math.max(1, requireIntEnv("AUTO_APPROVE_MAX_HOURS"));
}

/** Over the auto-approve limit, so an admin must approve it. */
export function needsApproval(startsAt: string, endsAt: string): boolean {
  return approvalRequiredFor(
    durationMinutes(startsAt, endsAt),
    autoApproveMaxHours(),
  );
}

/** Same threshold as approval, one step wider: `>=` needs a note, `>` also needs approval. */
export function noteRequired(startsAt: string, endsAt: string): boolean {
  return noteRequiredFor(
    durationMinutes(startsAt, endsAt),
    autoApproveMaxHours(),
  );
}

/** Round a minute onto the step grid, always up: anything off the grid is unreservable. */
export function ceilToStep(minutes: number): number {
  const step = stepMinutes();
  return Math.ceil(minutes / step) * step;
}

/** The same rule the form runs, with this server's hours supplied. */
export function isValidTimeOfDay(minutes: number): boolean {
  return isBookableMinute(
    minutes,
    openHour() * 60,
    closeHour() * 60,
    stepMinutes(),
  );
}

/** "09:30 - 11:00" for a reservation. */
export function rangeLabel(startsAt: string, endsAt: string): string {
  return `${timeOf(startsAt)} - ${timeOf(endsAt)}`;
}

/** "1h 30m" / "45m" for a plain minute count. */
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** "1h 30m" / "45m": a human duration for a reservation. */
export function durationLabel(startsAt: string, endsAt: string): string {
  return formatDuration(durationMinutes(startsAt, endsAt));
}

/** Reservable dates as YYYY-MM-DD, from today through the window. */
export function reservableDates(): string[] {
  const out: string[] = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0); // noon anchor avoids DST off-by-one when adding days
  for (let i = 0; i <= reservationWindowDays(); i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push(ymd(d));
  }
  return out;
}

/** Is this YYYY-MM-DD within the reservable window (not past, not beyond)? */
export function isReservableDate(date: string | undefined): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return reservableDates().includes(date);
}
