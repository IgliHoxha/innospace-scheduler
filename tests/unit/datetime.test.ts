import { describe, expect, it } from "vitest";
import * as t from "@/lib/datetime";

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

  it("maxTime returns the later of two HH:MM strings", () => {
    expect(t.maxTime("09:00", "11:30")).toBe("11:30");
    expect(t.maxTime("14:05", "14:00")).toBe("14:05");
    expect(t.maxTime("10:00", "10:00")).toBe("10:00");
  });

  it("measures duration in minutes and hours across a range", () => {
    expect(t.durationMinutes("2026-07-16T09:00", "2026-07-16T10:30")).toBe(90);
    expect(t.durationHours("2026-07-16T09:00", "2026-07-16T10:30")).toBe(1.5);
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

  // The board and picker both hand it "HH:MM"; the extra characters of a datetime must not confuse it.
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

describe("dates that cannot be parsed", () => {
  it("falls back rather than rendering NaN in an email", () => {
    for (const bad of [undefined, "", "not-a-date", "16-07-2026"]) {
      expect(t.formatDateLong(bad)).toBe("your requested date");
      expect(t.formatDateMedium(bad)).toBe("");
    }
  });
});
