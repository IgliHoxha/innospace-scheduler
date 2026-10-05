// No env read here, so client components can import these helpers.

export const pad2 = (n: number) => String(n).padStart(2, "0");

const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** Range-checked, not just shaped: "T25:00" would roll into the next day. */
function matchDateTime(value: string | undefined): RegExpExecArray | null {
  const m = DATETIME_RE.exec(value ?? "");
  return m && Number(m[2]) <= 23 && Number(m[3]) <= 59 ? m : null;
}

export function isDateTime(value: string | undefined): boolean {
  return !!matchDateTime(value);
}

/** Read in the server TZ; NaN if malformed. */
export function epochMsOf(dt: string): number {
  const m = matchDateTime(dt);
  if (!m) return NaN;
  const [y, mo, d] = m[1].split("-").map(Number);
  return new Date(y, mo - 1, d, Number(m[2]), Number(m[3])).getTime();
}

export function dateOf(dt: string): string {
  return dt.slice(0, 10);
}

/** "09:30" from "2026-07-16T09:30": also the <input type="time"> value. */
export function timeOf(dt: string): string {
  return dt.slice(11, 16);
}

export function toDateTime(date: string, time: string): string {
  return `${date}T${time}`;
}

export function minutesOfDay(dt: string): number {
  return timeToMinutes(timeOf(dt));
}

export function minutesToTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

export function timeToMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Assumes start/end are the same day. */
export function durationMinutes(startsAt: string, endsAt: string): number {
  return minutesOfDay(endsAt) - minutesOfDay(startsAt);
}

export function rangeLabel(startsAt: string, endsAt: string): string {
  return `${timeOf(startsAt)} - ${timeOf(endsAt)}`;
}

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Noon keeps a DST shift from skipping a day. */
export function shiftDate(date: string, days: number): string {
  const p = parseYMD(date);
  if (!p) return date;
  return ymd(new Date(p.y, p.m - 1, p.d + days, 12));
}

/** Local getters, never UTC: every time in the app is wall-clock. */
export function timeOfDate(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function todayYMD(): string {
  return ymd(new Date());
}

/** Same format as startsAt, so the two compare as plain text. */
export function nowDateTime(): string {
  const now = new Date();
  return `${ymd(now)}T${timeOfDate(now)}`;
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

/** Zeller-free weekday: build a UTC date purely from the parts. */
function weekdayOf(p: { y: number; m: number; d: number }): number {
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

export function formatDMYShort(value: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "-";
}

export function formatDateLong(value: string | undefined): string {
  const p = parseYMD(value);
  if (!p) return "your requested date";
  return `${WEEKDAYS[weekdayOf(p)]}, ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

export function formatDateMedium(value: string | undefined): string {
  const p = parseYMD(value);
  if (!p) return "";
  return `${WEEKDAYS_SHORT[weekdayOf(p)]}, ${p.d} ${MONTHS_SHORT[p.m - 1]}`;
}

/** Compact date and time for the created-at column; client-side only. */
export function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const yy = String(dt.getFullYear()).slice(2);
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${yy} ${timeOfDate(dt)}`;
}
