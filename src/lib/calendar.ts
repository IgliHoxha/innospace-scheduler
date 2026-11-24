// Add-to-calendar for a booking: an .ics file most calendars open, and a Google Calendar link.
import { epochMsOf } from "./datetime";

export interface CalendarEvent {
  /** Stable per booking, so a later email updates the entry instead of adding one. */
  uid: string;
  /** Local wall-clock "YYYY-MM-DDTHH:MM", like every stored time. */
  startsAt: string;
  endsAt: string;
  title: string;
  location: string;
  description: string;
  /** A pending request holds the slot but is not confirmed yet. */
  tentative: boolean;
}

/** "20260716T073000Z", the UTC form every calendar reads the same way. */
function utcStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** "2026-07-16T09:30" to "20260716T093000", read in the zone the link names. */
function localStamp(dt: string): string {
  return `${dt.replace(/[-:]/g, "")}00`;
}

/** RFC 5545 text: backslash, semicolon and comma are escaped, a line break becomes \n. */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
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
  stamp: Date,
): string {
  const valid = events.filter(hasTimes);
  if (valid.length === 0) return "";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Innospace//Scheduler//EN",
    "CALSCALE:GREGORIAN",
    // Published, not an invitation: there is no organiser to answer.
    "METHOD:PUBLISH",
  ];
  for (const e of valid) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${utcStamp(stamp.getTime())}`,
      `DTSTART:${utcStamp(epochMsOf(e.startsAt))}`,
      `DTEND:${utcStamp(epochMsOf(e.endsAt))}`,
      `SUMMARY:${escapeIcsText(e.title)}`,
      `LOCATION:${escapeIcsText(e.location)}`,
      `DESCRIPTION:${escapeIcsText(e.description)}`,
      `STATUS:${e.tentative ? "TENTATIVE" : "CONFIRMED"}`,
      // Higher once approved, so the confirmed copy replaces the tentative one.
      `SEQUENCE:${e.tentative ? 0 : 1}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/** Google's own "add event" page; a weekly series becomes one repeating entry. */
export function googleCalendarUrl(
  e: CalendarEvent,
  timeZone: string,
  weeks = 1,
): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${localStamp(e.startsAt)}/${localStamp(e.endsAt)}`,
    // Local times plus the zone, so a repeat keeps its hour across a clock change.
    ctz: timeZone,
    details: e.description,
    location: e.location,
  });
  if (weeks > 1) params.set("recur", `RRULE:FREQ=WEEKLY;COUNT=${weeks}`);
  return `https://calendar.google.com/calendar/render?${params}`;
}
