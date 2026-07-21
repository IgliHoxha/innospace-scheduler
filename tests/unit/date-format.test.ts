import { describe, expect, it } from "vitest";
import * as t from "@/lib/date-format";

describe("datetime string primitives", () => {
  it("accepts well-formed local datetimes and rejects malformed ones", () => {
    expect(t.isDateTime("2026-07-16T09:30")).toBe(true);
    expect(t.isDateTime("2026-07-16T23:59")).toBe(true);
    expect(t.isDateTime("2026-07-16T24:00")).toBe(false); // hour > 23
    expect(t.isDateTime("2026-07-16T09:60")).toBe(false); // minute > 59
    expect(t.isDateTime("2026-07-16 09:30")).toBe(false); // missing T
    expect(t.isDateTime(undefined)).toBe(false);
  });

  it("splits date and time and recombines them", () => {
    expect(t.dateOf("2026-07-16T09:30")).toBe("2026-07-16");
    expect(t.timeOf("2026-07-16T09:30")).toBe("09:30");
    expect(t.toDateTime("2026-07-16", "09:30")).toBe("2026-07-16T09:30");
    expect(t.minutesOfDay("2026-07-16T09:30")).toBe(570);
  });

  it("measures duration in minutes and hours across a range", () => {
    expect(t.durationMinutes("2026-07-16T09:00", "2026-07-16T10:30")).toBe(90);
    expect(t.durationHours("2026-07-16T09:00", "2026-07-16T10:30")).toBe(1.5);
  });
});

describe("clock-based helpers", () => {
  it("ymd formats a Date as YYYY-MM-DD (local, month 1-based)", () => {
    expect(t.ymd(new Date(2026, 6, 14))).toBe("2026-07-14");
    expect(t.ymd(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("todayYMD and nowDateTime produce the app's string shapes", () => {
    expect(t.todayYMD()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t.nowDateTime()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("date + time formatting", () => {
  it("formatDMYShort", () => {
    expect(t.formatDMYShort("2026-07-14")).toBe("14/07/26");
    expect(t.formatDMYShort(undefined)).toBe("-");
  });

  it("formatDateLong", () => {
    expect(t.formatDateLong("2026-07-14")).toMatch(/^[A-Za-z]+, 14 July 2026$/);
    expect(t.formatDateLong(undefined)).toBe("your requested date");
  });

  it("formatDateMedium", () => {
    expect(t.formatDateMedium("2026-07-14")).toMatch(/^[A-Za-z]{3}, 14 Jul$/);
    expect(t.formatDateMedium(undefined)).toBe("");
  });

  it("formatDateTime renders a local DD/MM/YY HH:MM, or empty for junk", () => {
    expect(t.formatDateTime("2026-07-14T14:30:00")).toBe("14/07/26 14:30");
    expect(t.formatDateTime("not-a-date")).toBe("");
  });
});
