// Datetime-string helpers for the app's "YYYY-MM-DDTHH:MM" local wall-clock format:
// extract, compose, validate, convert, diff, format, plus "now"/"today" from the
// system clock. No env or domain types, so mailer, dashboard, and picker share one.
import { pad2 } from "./utils";

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

/** Length of a reservation in minutes. Assumes start/end are the same day. */
export function durationMinutes(startsAt: string, endsAt: string): number {
  return minutesOfDay(endsAt) - minutesOfDay(startsAt);
}

/** Length of a reservation in hours, e.g. 1.5. */
export function durationHours(startsAt: string, endsAt: string): number {
  return durationMinutes(startsAt, endsAt) / 60;
}

/** Format a Date as YYYY-MM-DD in the server's local time. */
export function ymd(d: Date): string {
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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parseYMD(v: string | undefined) {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** Compact DD/MM/YY for the dashboard table, e.g. "14/07/26". */
export function formatDMYShort(value: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "-";
}

/** "Monday, 14 July 2026" for a YYYY-MM-DD. Timezone-free (parses the parts). */
export function formatDateLong(value: string | undefined): string {
  const p = parseYMD(value);
  if (!p) return "your requested date";
  // Zeller-free weekday: build a UTC date purely from the parts.
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** "Mon, 14 Jul" for a YYYY-MM-DD: compact label for the date picker. */
export function formatDateMedium(value: string | undefined): string {
  const p = parseYMD(value);
  if (!p) return "";
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${WEEKDAYS_SHORT[wd]}, ${p.d} ${MONTHS_SHORT[p.m - 1]}`;
}

/**
 * Compact date + time for the "created at" column, e.g. "14/07/26 14:30".
 * Uses the local timezone, so call it client-side only (hydration-safe).
 */
export function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const yy = String(dt.getFullYear()).slice(2);
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${yy} ${pad2(
    dt.getHours(),
  )}:${pad2(dt.getMinutes())}`;
}
