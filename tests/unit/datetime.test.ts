import { afterEach, describe, expect, it, vi } from "vitest";
import * as t from "@/lib/datetime";

afterEach(() => vi.useRealTimers());

describe("pad2", () => {
  it("zero-pads a single digit to two", () => {
    expect(t.pad2(0)).toBe("00");
    expect(t.pad2(9)).toBe("09");
  });

  it("leaves two-or-more digit numbers unchanged", () => {
    expect(t.pad2(10)).toBe("10");
    expect(t.pad2(59)).toBe("59");
    expect(t.pad2(123)).toBe("123");
  });
});

describe("datetime string primitives", () => {
  it("accepts well-formed local datetimes and rejects malformed ones", () => {
    expect(t.isDateTime("2026-07-16T09:30")).toBe(true);
    expect(t.isDateTime("2026-07-16T23:59")).toBe(true);
    expect(t.isDateTime("2026-07-16T24:00")).toBe(false);
    expect(t.isDateTime("2026-07-16T09:60")).toBe(false);
    expect(t.isDateTime("2026-07-16 09:30")).toBe(false);
    expect(t.isDateTime(undefined)).toBe(false);
  });

  it("splits date and time and recombines them", () => {
    expect(t.dateOf("2026-07-16T09:30")).toBe("2026-07-16");
    expect(t.timeOf("2026-07-16T09:30")).toBe("09:30");
    expect(t.toDateTime("2026-07-16", "09:30")).toBe("2026-07-16T09:30");
    expect(t.minutesOfDay("2026-07-16T09:30")).toBe(570);
  });

  it("maxTime returns the later of two HH:MM strings", () => {
    expect(t.maxTime("09:00", "11:30")).toBe("11:30");
    expect(t.maxTime("14:05", "14:00")).toBe("14:05");
    expect(t.maxTime("10:00", "10:00")).toBe("10:00");
  });

  it("measures duration in minutes and hours across a range", () => {
    expect(t.durationMinutes("2026-07-16T09:00", "2026-07-16T10:30")).toBe(90);
    expect(t.durationHours("2026-07-16T09:00", "2026-07-16T10:30")).toBe(1.5);
  });

  it("minutesOfDay reads a string with no time half as midnight", () => {
    expect(t.minutesOfDay("2026-07-16")).toBe(0);
    expect(t.minutesOfDay("")).toBe(0);
    expect(t.minutesOfDay("2026-07-16T00:00")).toBe(0);
    expect(t.minutesOfDay("2026-07-16T23:59")).toBe(1439);
  });

  it("minutesOfDay is NaN when the time half is not digits", () => {
    expect(Number.isNaN(t.minutesOfDay("2026-07-16Tab:cd"))).toBe(true);
    expect(Number.isNaN(t.minutesOfDay("2026-07-16T09:xx"))).toBe(true);
  });

  it("isDateTime checks the range of both halves and the whole shape", () => {
    expect(t.isDateTime("2026-07-16T00:00")).toBe(true);
    expect(t.isDateTime("2026-07-16T23:60")).toBe(false);
    expect(t.isDateTime("2026-07-16T99:99")).toBe(false);
    expect(t.isDateTime("2026-07-16T09:30:00")).toBe(false);
    expect(t.isDateTime("2026-7-16T09:30")).toBe(false);
    expect(t.isDateTime("")).toBe(false);
  });
});

describe("durations", () => {
  it("labels durations for humans", () => {
    expect(t.durationLabel("2026-07-16T09:00", "2026-07-16T10:30")).toBe(
      "1h 30m",
    );
    expect(t.durationLabel("2026-07-16T09:00", "2026-07-16T10:00")).toBe("1h");
    expect(t.durationLabel("2026-07-16T09:00", "2026-07-16T09:45")).toBe("45m");
  });

  it("formatDuration formats a plain minute count", () => {
    expect(t.formatDuration(90)).toBe("1h 30m");
    expect(t.formatDuration(60)).toBe("1h");
    expect(t.formatDuration(45)).toBe("45m");
    expect(t.formatDuration(0)).toBe("0m");
  });

  it("renders the range label with a plain hyphen", () => {
    expect(t.rangeLabel("2026-07-16T09:30", "2026-07-16T11:00")).toBe(
      "09:30 - 11:00",
    );
  });
});

describe("minutesToTime", () => {
  it("is the inverse of minutesOfDay", () => {
    expect(t.minutesToTime(570)).toBe("09:30");
    expect(t.minutesToTime(0)).toBe("00:00");
    expect(t.minutesToTime(t.minutesOfDay("2026-07-16T15:25"))).toBe("15:25");
  });
});

describe("timeToMinutes", () => {
  it("reads a bare HH:MM", () => {
    expect(t.timeToMinutes("09:30")).toBe(570);
    expect(t.timeToMinutes("00:00")).toBe(0);
    expect(t.timeToMinutes("18:00")).toBe(1080);
    expect(t.timeToMinutes("23:59")).toBe(1439);
  });

  it("round-trips with minutesToTime both ways", () => {
    for (const m of [0, 5, 540, 570, 1080, 1439]) {
      expect(t.timeToMinutes(t.minutesToTime(m))).toBe(m);
    }
    for (const s of ["00:00", "09:05", "13:45", "23:59"]) {
      expect(t.minutesToTime(t.timeToMinutes(s))).toBe(s);
    }
  });

  // Both hand it "HH:MM", so a datetime's extra characters must not confuse it.
  it("agrees with minutesOfDay on the time half of a datetime", () => {
    expect(t.timeToMinutes(t.timeOf("2026-07-16T15:25"))).toBe(
      t.minutesOfDay("2026-07-16T15:25"),
    );
  });
});

describe("epochMsOf", () => {
  it("reads a wall-clock string in the server's own timezone", () => {
    expect(t.epochMsOf("2026-07-16T14:30")).toBe(
      new Date(2026, 6, 16, 14, 30).getTime(),
    );
  });

  it("orders as the strings do, so it can drive a token expiry", () => {
    expect(t.epochMsOf("2026-07-16T15:00")).toBeGreaterThan(
      t.epochMsOf("2026-07-16T14:00"),
    );
  });

  it("is NaN for anything malformed", () => {
    for (const v of ["", "2026-07-16", "2026-07-16T25:00", "nope"]) {
      expect(Number.isNaN(t.epochMsOf(v))).toBe(true);
    }
  });

  it("reads the first and the last minute of a day", () => {
    expect(t.epochMsOf("2026-07-16T00:00")).toBe(
      new Date(2026, 6, 16, 0, 0).getTime(),
    );
    expect(t.epochMsOf("2026-07-16T23:59")).toBe(
      new Date(2026, 6, 16, 23, 59).getTime(),
    );
  });

  it("is NaN exactly where isDateTime says no", () => {
    for (const v of [
      "2026-07-16T24:00",
      "2026-07-16T09:60",
      "2026-07-16 09:30",
    ]) {
      expect(t.isDateTime(v)).toBe(false);
      expect(Number.isNaN(t.epochMsOf(v))).toBe(true);
    }
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

  it("timeOfDate formats a Date as local HH:MM, zero-padded", () => {
    expect(t.timeOfDate(new Date(2026, 6, 14, 9, 5))).toBe("09:05");
    expect(t.timeOfDate(new Date(2026, 6, 14, 0, 0))).toBe("00:00");
    expect(t.timeOfDate(new Date(2026, 6, 14, 23, 59))).toBe("23:59");
  });

  it("timeOfDate drops seconds and ignores the date half", () => {
    expect(t.timeOfDate(new Date(2000, 0, 1, 14, 30, 59, 999))).toBe("14:30");
    expect(t.timeOfDate(new Date(2026, 11, 31, 7, 0))).toBe("07:00");
  });

  it("timeOfDate is the time half of nowDateTime", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 6, 14, 8, 7) });
    expect(t.timeOf(t.nowDateTime())).toBe(t.timeOfDate(new Date()));
    expect(t.timeOfDate(new Date())).toBe("08:07");
  });

  it("todayYMD and nowDateTime read the clock, zero-padded", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 0, 5, 9, 5, 59) });
    expect(t.todayYMD()).toBe("2026-01-05");
    expect(t.nowDateTime()).toBe("2026-01-05T09:05");
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59));
    expect(t.nowDateTime()).toBe("2026-12-31T23:59");
    vi.setSystemTime(new Date(2026, 6, 14, 0, 0));
    expect(t.nowDateTime()).toBe("2026-07-14T00:00");
  });
});

describe("shiftDate", () => {
  it("steps to the next and the previous calendar day", () => {
    expect(t.shiftDate("2026-07-16", 1)).toBe("2026-07-17");
    expect(t.shiftDate("2026-07-16", -1)).toBe("2026-07-15");
    expect(t.shiftDate("2026-07-16", 0)).toBe("2026-07-16");
  });

  it("rolls over a month, a year and a leap day", () => {
    expect(t.shiftDate("2026-07-31", 1)).toBe("2026-08-01");
    expect(t.shiftDate("2026-08-01", -1)).toBe("2026-07-31");
    expect(t.shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(t.shiftDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(t.shiftDate("2027-02-28", 1)).toBe("2027-03-01");
  });

  // A 23-hour or 25-hour day must still be exactly one date apart.
  it("is not thrown by a clock change on either side", () => {
    expect(t.shiftDate("2026-10-24", 1)).toBe("2026-10-25");
    expect(t.shiftDate("2026-10-25", 1)).toBe("2026-10-26");
    expect(t.shiftDate("2026-03-29", -1)).toBe("2026-03-28");
    expect(t.shiftDate("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("hands back what it cannot parse", () => {
    expect(t.shiftDate("not-a-date", 1)).toBe("not-a-date");
    expect(t.shiftDate("", 1)).toBe("");
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

  it("formatDateTime zero-pads every part", () => {
    expect(t.formatDateTime("2026-01-05T03:07:00")).toBe("05/01/26 03:07");
    expect(t.formatDateTime("2026-12-31T00:00:00")).toBe("31/12/26 00:00");
  });

  // The weekday comes from the date parts alone, never from the server timezone.
  it("names the right weekday in the long and the medium form", () => {
    expect(t.formatDateLong("2026-07-14")).toBe("Tuesday, 14 July 2026");
    expect(t.formatDateLong("2026-01-01")).toBe("Thursday, 1 January 2026");
    expect(t.formatDateLong("2028-02-29")).toBe("Tuesday, 29 February 2028");
    expect(t.formatDateMedium("2026-07-14")).toBe("Tue, 14 Jul");
    expect(t.formatDateMedium("2026-12-31")).toBe("Thu, 31 Dec");
    expect(t.formatDateMedium("2026-01-01")).toBe("Thu, 1 Jan");
  });

  it("formats the date half of a full datetime too", () => {
    expect(t.formatDateLong("2026-07-14T09:30")).toBe("Tuesday, 14 July 2026");
    expect(t.formatDateMedium("2026-07-14T09:30")).toBe("Tue, 14 Jul");
    expect(t.formatDMYShort("2026-07-14T09:30")).toBe("14/07/26");
  });
});

describe("dates that cannot be parsed", () => {
  it("falls back rather than rendering NaN in an email", () => {
    for (const bad of [undefined, "", "not-a-date", "16-07-2026"]) {
      expect(t.formatDateLong(bad)).toBe("your requested date");
      expect(t.formatDateMedium(bad)).toBe("");
    }
  });
});
