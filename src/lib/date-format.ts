// Pure, timezone-safe date/time formatting. Takes plain strings (no domain
// types), so the mailer, the dashboard, and the picker all share one source.
import { pad2 } from "./utils";

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
