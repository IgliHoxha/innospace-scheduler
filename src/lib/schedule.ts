// Time rules. A booking is a start/end local datetime "YYYY-MM-DDTHH:MM" (no TZ:
// set TZ so the server matches the space). The format sorts as text, so SQLite
// indexes it directly and the date is the first 10 chars.
import { approvalRequiredFor, noteRequiredFor } from "./booking-rules";

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isInteger(v) ? v : fallback;
}

/** First bookable hour of the day (24h). Default 09:00. */
export function openHour(): number {
  return Math.min(23, Math.max(0, intEnv("OPEN_HOUR", 9)));
}

/** Closing hour: a booking must end by this hour. Default 18:00. */
export function closeHour(): number {
  return Math.min(24, Math.max(openHour() + 1, intEnv("CLOSE_HOUR", 18)));
}

/** How many days ahead (including today) can be booked. Default 14. */
export function bookingWindowDays(): number {
  return Math.max(0, intEnv("BOOKING_WINDOW_DAYS", 14));
}

/**
 * Times snap to this many minutes, so members can pick 09:10 but not 09:07.
 * Must divide 60 evenly (1/5/10/15/30/60). Default 5. Env: TIME_STEP_MINUTES.
 */
export function stepMinutes(): number {
  const v = intEnv("TIME_STEP_MINUTES", 5);
  return v > 0 && v <= 60 && 60 % v === 0 ? v : 5;
}

/** Shortest bookable length, in minutes. Default 15. Env: MIN_BOOKING_MINUTES. */
export function minBookingMinutes(): number {
  return Math.max(stepMinutes(), intEnv("MIN_BOOKING_MINUTES", 15));
}

/**
 * Longest booking (in hours) that is auto-confirmed. Anything longer is created
 * as "pending" and needs admin approval. Default 2. Env: AUTO_APPROVE_MAX_HOURS.
 */
export function autoApproveMaxHours(): number {
  return Math.max(1, intEnv("AUTO_APPROVE_MAX_HOURS", 2));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** Is this a well-formed "YYYY-MM-DDTHH:MM" local datetime? */
export function isDateTime(value: string | undefined): boolean {
  const m = DATETIME_RE.exec(value ?? "");
  return !!m && Number(m[2]) <= 23 && Number(m[3]) <= 59;
}

/** "2026-07-16" from "2026-07-16T09:30". */
export function dateOf(dt: string): string {
  return dt.slice(0, 10);
}

/** "09:30" from "2026-07-16T09:30": also the <input type="time"> value. */
export function timeOf(dt: string): string {
  return dt.slice(11, 16);
}

/** Join a date and a "HH:MM" time into a datetime string. */
export function toDateTime(date: string, time: string): string {
  return `${date}T${time}`;
}

/** Minutes since midnight for a datetime, e.g. 570 for "…T09:30". */
export function minutesOfDay(dt: string): number {
  return Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16));
}

/** Length of a booking in minutes. Assumes start/end are the same day. */
export function durationMinutes(startsAt: string, endsAt: string): number {
  return minutesOfDay(endsAt) - minutesOfDay(startsAt);
}

/** Length of a booking in hours, e.g. 1.5. */
export function durationHours(startsAt: string, endsAt: string): number {
  return durationMinutes(startsAt, endsAt) / 60;
}

/** Does this booking exceed the auto-approve limit (so needs admin approval)? */
export function needsApproval(startsAt: string, endsAt: string): boolean {
  return approvalRequiredFor(
    durationMinutes(startsAt, endsAt),
    autoApproveMaxHours(),
  );
}

/**
 * Bookings this long need a note (admin context). Same threshold as auto-approve:
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

/** "09:30 – 11:00" for a booking. */
export function rangeLabel(startsAt: string, endsAt: string): string {
  return `${timeOf(startsAt)} – ${timeOf(endsAt)}`;
}

/** "1h 30m" / "45m": a human duration for a booking. */
export function durationLabel(startsAt: string, endsAt: string): string {
  const total = durationMinutes(startsAt, endsAt);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Server-local today as YYYY-MM-DD. */
export function todayYMD(): string {
  return ymd(new Date());
}

/** Server-local now as "YYYY-MM-DDTHH:MM": compares directly against startsAt. */
export function nowDateTime(): string {
  const now = new Date();
  return `${ymd(now)}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

/** Bookable dates as YYYY-MM-DD, from today through the window. */
export function bookableDates(): string[] {
  const out: string[] = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0); // noon anchor avoids DST off-by-one when adding days
  for (let i = 0; i <= bookingWindowDays(); i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push(ymd(d));
  }
  return out;
}

/** Is this YYYY-MM-DD within the bookable window (not past, not beyond)? */
export function isBookableDate(date: string | undefined): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return bookableDates().includes(date);
}
