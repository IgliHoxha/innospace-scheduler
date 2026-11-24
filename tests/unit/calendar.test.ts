import { describe, expect, it } from "vitest";
import {
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  icsCalendar,
  sequenceOf,
  type CalendarEvent,
} from "@/lib/calendar";

const EVENT: CalendarEvent = {
  uid: "rs_1@scheduler.example.test",
  startsAt: "2026-07-16T09:30",
  endsAt: "2026-07-16T11:00",
  title: "Booth 1 at Test Org",
  location: "Test Org",
  description: "Your Booth 1 reservation.\nQuestions: +000 000",
  status: "CONFIRMED",
  sequence: 7,
};
const STAMP = new Date("2026-07-01T10:00:00.000Z");

// The host's zone decides the UTC instant, exactly as epochMsOf does for every stored time.
const utc = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const linesOf = (ics: string) => unfold(ics).split("\r\n");

describe("escapeIcsText", () => {
  it("escapes the characters RFC 5545 reserves, backslash first", () => {
    expect(escapeIcsText(String.raw`a\b;c,d`)).toBe(String.raw`a\\b\;c\,d`);
  });

  it("turns any line break into a literal \\n", () => {
    expect(escapeIcsText("one\ntwo\r\nthree")).toBe("one\\ntwo\\nthree");
  });

  it("leaves markup alone: a calendar shows text, it runs nothing", () => {
    expect(escapeIcsText("<script>alert('aaa')</script>")).toBe(
      "<script>alert('aaa')</script>",
    );
  });
});

describe("foldIcsLine", () => {
  it("leaves a line of 75 octets as it is", () => {
    expect(foldIcsLine("x".repeat(75))).toBe("x".repeat(75));
  });

  it("continues a longer one on lines opening with a space, none over 75 octets", () => {
    const folded = foldIcsLine("x".repeat(200));
    const parts = folded.split("\r\n");
    expect(parts[0]).toHaveLength(75);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.every((p) => Buffer.byteLength(p) <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe("x".repeat(200));
  });

  it("counts bytes, and never splits a multi-byte character", () => {
    const line = "Shënim: ".repeat(20);
    const parts = foldIcsLine(line).split("\r\n");
    expect(parts.every((p) => Buffer.byteLength(p) <= 75)).toBe(true);
    expect(foldIcsLine(line).replace(/\r\n /g, "")).toBe(line);
  });
});

describe("sequenceOf", () => {
  it("rises with every later change", () => {
    const made = sequenceOf("2026-07-01T10:00:00.000Z");
    const approved = sequenceOf("2026-07-01T10:05:00.000Z");
    const cancelled = sequenceOf("2026-07-02T08:00:00.000Z");
    expect(approved).toBeGreaterThan(made);
    expect(cancelled).toBeGreaterThan(approved);
  });

  it("stays a small whole number, which every calendar can store", () => {
    const n = sequenceOf("2036-01-01T00:00:00.000Z");
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeLessThan(2 ** 31);
  });

  it("is 0 for a missing or unreadable time", () => {
    expect(sequenceOf("")).toBe(0);
    expect(sequenceOf("nope")).toBe(0);
    expect(sequenceOf("2020-01-01T00:00:00.000Z")).toBe(0);
  });
});

describe("icsCalendar", () => {
  it("wraps the events in a published calendar with CRLF line ends", () => {
    const ics = icsCalendar([EVENT], STAMP);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/\n/);
    // Published, never an invitation: that is what makes Gmail offer "Report spam".
    expect(linesOf(ics)).toContain("METHOD:PUBLISH");
    expect(ics).not.toMatch(/METHOD:(REQUEST|CANCEL)|ORGANIZER|ATTENDEE/);
  });

  it("carries the booking's times in UTC, its id, version and escaped text", () => {
    const lines = linesOf(icsCalendar([EVENT], STAMP));
    expect(lines).toEqual(
      expect.arrayContaining([
        "UID:rs_1@scheduler.example.test",
        "SEQUENCE:7",
        "DTSTAMP:20260701T100000Z",
        `DTSTART:${utc(2026, 7, 16, 9, 30)}`,
        `DTEND:${utc(2026, 7, 16, 11, 0)}`,
        "SUMMARY:Booth 1 at Test Org",
        "LOCATION:Test Org",
        "DESCRIPTION:Your Booth 1 reservation.\\nQuestions: +000 000",
        "STATUS:CONFIRMED",
      ]),
    );
  });

  it("holds one event per date of a series", () => {
    const ics = icsCalendar(
      [
        EVENT,
        {
          ...EVENT,
          uid: "rs_2@scheduler.example.test",
          startsAt: "2026-07-23T09:30",
          endsAt: "2026-07-23T11:00",
        },
      ],
      STAMP,
    );
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(linesOf(ics)).toContain(`DTSTART:${utc(2026, 7, 23, 9, 30)}`);
  });

  it("drops an event without valid times, and is empty when none is left", () => {
    expect(icsCalendar([{ ...EVENT, startsAt: "" }], STAMP)).toBe("");
    expect(
      icsCalendar([EVENT, { ...EVENT, endsAt: "nope" }], STAMP).match(
        /BEGIN:VEVENT/g,
      ),
    ).toHaveLength(1);
  });

  it("folds a long description so no line runs past 75 octets", () => {
    const ics = icsCalendar(
      [{ ...EVENT, description: "word ".repeat(60) }],
      STAMP,
    );
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(
      true,
    );
  });
});

describe("googleCalendarUrl", () => {
  const params = (url: string) => new URL(url).searchParams;

  it("opens Google's add-event page with the booking filled in", () => {
    const url = googleCalendarUrl(EVENT, "Europe/Tirane");
    expect(url.startsWith("https://calendar.google.com/calendar/render?")).toBe(
      true,
    );
    const p = params(url);
    expect(p.get("action")).toBe("TEMPLATE");
    expect(p.get("text")).toBe("Booth 1 at Test Org");
    expect(p.get("location")).toBe("Test Org");
    expect(p.get("details")).toBe(EVENT.description);
    expect(p.has("recur")).toBe(false);
  });

  // Local time plus the zone, so the hour holds whatever zone the reader is in.
  it("gives the space's wall-clock times and names its zone", () => {
    const p = params(googleCalendarUrl(EVENT, "Europe/Tirane"));
    expect(p.get("dates")).toBe("20260716T093000/20260716T110000");
    expect(p.get("ctz")).toBe("Europe/Tirane");
  });

  it("makes a weekly series one repeating entry", () => {
    const p = params(googleCalendarUrl(EVENT, "Europe/Tirane", 4));
    expect(p.get("recur")).toBe("RRULE:FREQ=WEEKLY;COUNT=4");
  });
});
