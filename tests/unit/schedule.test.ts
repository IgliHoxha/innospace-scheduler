import { afterEach, describe, expect, it, vi } from "vitest";
import * as schedule from "@/lib/schedule";
import { todayYMD } from "@/lib/datetime";

afterEach(() => vi.unstubAllEnvs());

describe("autoApproveMaxHours", () => {
  it("reads the limit at call time, so an override takes effect", () => {
    expect(schedule.autoApproveMaxHours()).toBe(2);
    vi.stubEnv("AUTO_APPROVE_MAX_HOURS", "1");
    expect(schedule.autoApproveMaxHours()).toBe(1);
    vi.stubEnv("AUTO_APPROVE_MAX_HOURS", "5");
    expect(schedule.autoApproveMaxHours()).toBe(5);
  });

  it("never drops below one hour", () => {
    vi.stubEnv("AUTO_APPROVE_MAX_HOURS", "0");
    expect(schedule.autoApproveMaxHours()).toBe(1);
  });
});

describe("ceilToStep", () => {
  it("leaves a time already on the grid alone", () => {
    expect(schedule.ceilToStep(9 * 60)).toBe(9 * 60);
    expect(schedule.ceilToStep(9 * 60 + 5)).toBe(9 * 60 + 5);
  });

  it("rounds an arbitrary minute up to the next boundary", () => {
    // The real case: "now" is 15:22, which nothing can reserve.
    expect(schedule.ceilToStep(15 * 60 + 22)).toBe(15 * 60 + 25);
    expect(schedule.ceilToStep(15 * 60 + 1)).toBe(15 * 60 + 5);
    expect(schedule.ceilToStep(15 * 60 + 59)).toBe(16 * 60);
  });

  it("always lands on a time isValidTimeOfDay accepts", () => {
    for (let m = 9 * 60; m < 18 * 60; m++) {
      expect(schedule.isValidTimeOfDay(schedule.ceilToStep(m))).toBe(true);
    }
  });

  it("follows TIME_STEP_MINUTES", () => {
    vi.stubEnv("TIME_STEP_MINUTES", "15");
    expect(schedule.ceilToStep(9 * 60 + 1)).toBe(9 * 60 + 15);
    expect(schedule.ceilToStep(9 * 60 + 16)).toBe(9 * 60 + 30);
  });
});

describe("isValidTimeOfDay", () => {
  it("enforces the step grid at any hour of the day (step 5)", () => {
    expect(schedule.isValidTimeOfDay(0)).toBe(true);
    expect(schedule.isValidTimeOfDay(3 * 60 + 5)).toBe(true);
    expect(schedule.isValidTimeOfDay(9 * 60)).toBe(true);
    expect(schedule.isValidTimeOfDay(23 * 60 + 55)).toBe(true); // the last step
    expect(schedule.isValidTimeOfDay(9 * 60 + 7)).toBe(false);
    expect(schedule.isValidTimeOfDay(24 * 60)).toBe(false); // 24:00 is not a time
    expect(schedule.isValidTimeOfDay(-5)).toBe(false);
    expect(schedule.isValidTimeOfDay(9.5 as unknown as number)).toBe(false);
  });

  it("honours a TIME_STEP_MINUTES override, which also moves the last step", () => {
    vi.stubEnv("TIME_STEP_MINUTES", "15");
    expect(schedule.isValidTimeOfDay(8 * 60)).toBe(true);
    expect(schedule.isValidTimeOfDay(8 * 60 + 5)).toBe(false);
    expect(schedule.isValidTimeOfDay(8 * 60 + 15)).toBe(true);
    expect(schedule.isValidTimeOfDay(23 * 60 + 45)).toBe(true);
    expect(schedule.isValidTimeOfDay(24 * 60)).toBe(false);
  });

  // The two vars may linger in a deployed env; they must change nothing.
  it("ignores OPEN_HOUR and CLOSE_HOUR entirely, set or unset", () => {
    expect(schedule.isValidTimeOfDay(6 * 60)).toBe(true);
    vi.stubEnv("OPEN_HOUR", "10");
    vi.stubEnv("CLOSE_HOUR", "12");
    expect(schedule.isValidTimeOfDay(6 * 60)).toBe(true);
    expect(schedule.isValidTimeOfDay(20 * 60)).toBe(true);
  });

  it("no longer exports the opening-hour readers", () => {
    expect("openHour" in schedule).toBe(false);
    expect("closeHour" in schedule).toBe(false);
  });

  it("throws when TIME_STEP_MINUTES does not divide 60", () => {
    expect(schedule.stepMinutes()).toBe(5); // baseline
    vi.stubEnv("TIME_STEP_MINUTES", "7");
    expect(() => schedule.stepMinutes()).toThrow();
    vi.stubEnv("TIME_STEP_MINUTES", "90");
    expect(() => schedule.stepMinutes()).toThrow();
  });
});

describe("reservation window", () => {
  it("treats today as reservable and rejects malformed or out-of-window dates", () => {
    const today = todayYMD();
    expect(schedule.isReservableDate(today)).toBe(true);
    expect(schedule.isReservableDate("not-a-date")).toBe(false);
    expect(schedule.isReservableDate("1999-01-01")).toBe(false);
    expect(schedule.isReservableDate(undefined)).toBe(false);
    expect(schedule.reservableDates()[0]).toBe(today);
  });
});

describe("reservableDates", () => {
  afterEach(() => vi.useRealTimers());

  it("lists today plus the window, a day apart, across a month end", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 6, 30, 23, 50) });
    vi.stubEnv("RESERVATION_WINDOW_DAYS", "3");
    expect(schedule.reservableDates()).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("rolls over a year end and a leap day", () => {
    vi.stubEnv("RESERVATION_WINDOW_DAYS", "1");
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 11, 31, 0, 5) });
    expect(schedule.reservableDates()).toEqual(["2026-12-31", "2027-01-01"]);
    vi.setSystemTime(new Date(2028, 1, 28, 12, 0));
    expect(schedule.reservableDates()).toEqual(["2028-02-28", "2028-02-29"]);
  });

  // A 23-hour or 25-hour day inside the window must not skip or repeat a date.
  it("is not thrown by a clock change inside the window", () => {
    vi.stubEnv("RESERVATION_WINDOW_DAYS", "2");
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 24, 0, 30) });
    expect(schedule.reservableDates()).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
    vi.setSystemTime(new Date(2026, 2, 28, 23, 30));
    expect(schedule.reservableDates()).toEqual([
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ]);
  });

  it("is today plus the baseline fourteen days", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 6, 16, 9, 30) });
    const dates = schedule.reservableDates();
    expect(dates).toHaveLength(15);
    expect(dates[0]).toBe(todayYMD());
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(15);
  });

  it("offers today alone when the window is zero or negative", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 6, 16, 9, 30) });
    vi.stubEnv("RESERVATION_WINDOW_DAYS", "0");
    expect(schedule.reservableDates()).toEqual([todayYMD()]);
    vi.stubEnv("RESERVATION_WINDOW_DAYS", "-4");
    expect(schedule.reservableDates()).toEqual([todayYMD()]);
  });

  it("throws when RESERVATION_WINDOW_DAYS is unset or not an integer", () => {
    vi.stubEnv("RESERVATION_WINDOW_DAYS", "");
    expect(() => schedule.reservableDates()).toThrow();
    vi.stubEnv("RESERVATION_WINDOW_DAYS", "soon");
    expect(() => schedule.reservableDates()).toThrow();
  });
});
