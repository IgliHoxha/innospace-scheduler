// A booking as a calendar invitation: mail apps add it on arrival and withdraw it on a cancel.
import { epochMsOf } from "./datetime";

/** REQUEST adds or updates the entry; CANCEL withdraws it. */
export type CalendarMethod = "REQUEST" | "CANCEL";

export type CalendarStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED";

export interface CalendarPerson {
  name: string;
  email: string;
}

export interface CalendarEvent {
  /** Stable per booking, so a later email updates or withdraws the same entry. */
  uid: string;
  /** Local wall-clock "YYYY-MM-DDTHH:MM", like every stored time. */
  startsAt: string;
  endsAt: string;
  title: string;
  location: string;
  description: string;
  status: CalendarStatus;
  /** Rises with every change, or a calendar ignores the newer email as stale. */
  sequence: number;
  organizer: CalendarPerson;
  attendee: CalendarPerson;
}

// Counted from here, so the number stays small enough for every client's integer.
const SEQUENCE_EPOCH_MS = Date.UTC(2026, 0, 1);

/** Seconds since 2026 of the booking's last change: each status change sends a higher one. */
export function sequenceOf(updatedAtIso: string): number {
  const ms = Date.parse(updatedAtIso);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((ms - SEQUENCE_EPOCH_MS) / 1000));
}

/** "20260716T073000Z", the UTC form every calendar reads the same way. */
function utcStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** RFC 5545 text: backslash, semicolon and comma are escaped, a line break becomes \n. */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** A quoted parameter value, which may hold no quote and no control character at all. */
function icsParam(s: string): string {
  return `"${s.replace(/["\u0000-\u001f\u007f]/g, " ").trim()}"`;
}

function person(role: "ORGANIZER" | "ATTENDEE", p: CalendarPerson): string {
  const extra =
    role === "ATTENDEE"
      ? ";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE"
      : "";
  return `${role};CN=${icsParam(p.name)}${extra}:mailto:${p.email}`;
}

const encoder = new TextEncoder();

/** Lines are capped at 75 octets; the rest continues on lines opening with one space. */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  // By code point, so a multi-byte character is never split across lines.
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      // The leading space of a continuation counts towards its 75.
      limit = 74;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const hasTimes = (e: CalendarEvent): boolean =>
  Number.isFinite(epochMsOf(e.startsAt)) &&
  Number.isFinite(epochMsOf(e.endsAt));

/** One VCALENDAR holding every event; empty string when none has valid times. */
export function icsCalendar(
  events: readonly CalendarEvent[],
  method: CalendarMethod,
  stamp: Date,
): string {
  const valid = events.filter(hasTimes);
  if (valid.length === 0) return "";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Innospace//Scheduler//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
  ];
  for (const e of valid) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `SEQUENCE:${e.sequence}`,
      `DTSTAMP:${utcStamp(stamp.getTime())}`,
      `DTSTART:${utcStamp(epochMsOf(e.startsAt))}`,
      `DTEND:${utcStamp(epochMsOf(e.endsAt))}`,
      `SUMMARY:${escapeIcsText(e.title)}`,
      `LOCATION:${escapeIcsText(e.location)}`,
      `DESCRIPTION:${escapeIcsText(e.description)}`,
      `STATUS:${e.status}`,
      person("ORGANIZER", e.organizer),
      person("ATTENDEE", e.attendee),
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
