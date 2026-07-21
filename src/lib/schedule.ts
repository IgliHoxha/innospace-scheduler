// Time rules. A reservation is a start/end local datetime "YYYY-MM-DDTHH:MM" (no
// TZ suffix: set TZ so the server matches the space). The format sorts as text,
// so SQLite indexes it directly and the date is the first 10 chars.
import { approvalRequiredFor, noteRequiredFor } from "./reservation-rules";
import { requireIntEnv } from "./env-app";
import { timeOf, durationMinutes, ymd } from "./date-format";

/** First reservable hour of the day (24h). Required. Env: OPEN_HOUR. */
export function openHour(): number {
  return Math.min(23, Math.max(0, requireIntEnv("OPEN_HOUR")));
}

/** Closing hour: a reservation must end by this hour. Required. Env: CLOSE_HOUR. */
export function closeHour(): number {
  return Math.min(24, Math.max(openHour() + 1, requireIntEnv("CLOSE_HOUR")));
}

/** How many days ahead (including today) can be reserved. Required. Env: RESERVATION_WINDOW_DAYS. */
export function reservationWindowDays(): number {
  return Math.max(0, requireIntEnv("RESERVATION_WINDOW_DAYS"));
}

/**
 * Times snap to this many minutes, so members can pick 09:10 but not 09:07.
 * Must divide 60 evenly (1/5/10/15/30/60). Required. Env: TIME_STEP_MINUTES.
 */
export function stepMinutes(): number {
  const v = requireIntEnv("TIME_STEP_MINUTES");
  if (!(v > 0 && v <= 60 && 60 % v === 0)) {
    throw new Error(
      "TIME_STEP_MINUTES must divide 60 evenly (1/5/10/15/30/60).",
    );
  }
  return v;
}

/** Shortest reservable length, in minutes. Required. Env: MIN_RESERVATION_MINUTES. */
export function minReservationMinutes(): number {
  return Math.max(stepMinutes(), requireIntEnv("MIN_RESERVATION_MINUTES"));
}

/**
 * Longest reservation (in hours) that is auto-confirmed. Anything longer is created
 * as "pending" and needs admin approval. Required. Env: AUTO_APPROVE_MAX_HOURS.
 */
export function autoApproveMaxHours(): number {
  return Math.max(1, requireIntEnv("AUTO_APPROVE_MAX_HOURS"));
}

/** Does this reservation exceed the auto-approve limit (so needs admin approval)? */
export function needsApproval(startsAt: string, endsAt: string): boolean {
  return approvalRequiredFor(
    durationMinutes(startsAt, endsAt),
    autoApproveMaxHours(),
  );
}

/**
 * Reservations this long need a note (admin context). Same threshold as auto-approve:
 * >= needs a note, > also needs approval.
 */
export function noteRequired(startsAt: string, endsAt: string): boolean {
  return noteRequiredFor(
    durationMinutes(startsAt, endsAt),
    autoApproveMaxHours(),
  );
}

/** Is this time-of-day on the step grid and inside the opening window? */
export function isValidTimeOfDay(minutes: number): boolean {
  if (!Number.isInteger(minutes)) return false;
  if (minutes < openHour() * 60 || minutes > closeHour() * 60) return false;
  return minutes % stepMinutes() === 0;
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
