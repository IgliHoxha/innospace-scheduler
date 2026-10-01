import { afterEach, describe, expect, it, vi } from "vitest";
import * as schedule from "@/lib/schedule";
import { todayYMD } from "@/lib/datetime";

afterEach(() => vi.unstubAllEnvs());

describe("durations", () => {
  it("labels durations for humans", () => {
    expect(schedule.durationLabel("2026-07-16T09:00", "2026-07-16T10:30")).toBe(
      "1h 30m",
    );
    expect(schedule.durationLabel("2026-07-16T09:00", "2026-07-16T10:00")).toBe(
      "1h",
    );
    expect(schedule.durationLabel("2026-07-16T09:00", "2026-07-16T09:45")).toBe(
      "45m",
    );
  });

  it("formatDuration formats a plain minute count", () => {
    expect(schedule.formatDuration(90)).toBe("1h 30m");
    expect(schedule.formatDuration(60)).toBe("1h");
    expect(schedule.formatDuration(45)).toBe("45m");
    expect(schedule.formatDuration(0)).toBe("0m");
  });

  it("renders the range label with the product en dash", () => {
    expect(schedule.rangeLabel("2026-07-16T09:30", "2026-07-16T11:00")).toBe(
      "09:30 - 11:00",
    );
  });
});

describe("reservationCountLabel", () => {
  it("shows a zero rather than hiding an empty booth", () => {
    expect(schedule.reservationCountLabel(0)).toBe("0 reservations");
  });

  it("keeps one singular", () => {
    expect(schedule.reservationCountLabel(1)).toBe("1 reservation");
  });

  it("pluralises anything above one", () => {
    expect(schedule.reservationCountLabel(2)).toBe("2 reservations");
    expect(schedule.reservationCountLabel(37)).toBe("37 reservations");
  });

  // A count is never negative, but a bad one must not print "-1 reservations".
  it("reads a negative count as zero", () => {
    expect(schedule.reservationCountLabel(-1)).toBe("0 reservations");
  });
});

describe("approval + note thresholds", () => {
  it("needs approval strictly over the auto-approve limit; note at or over it", () => {
    // default AUTO_APPROVE_MAX_HOURS = 2
    expect(schedule.needsApproval("2026-07-16T09:00", "2026-07-16T11:00")).toBe(
      false,
    ); // exactly 2h
    expect(schedule.needsApproval("2026-07-16T09:00", "2026-07-16T11:30")).toBe(
      true,
    ); // 2.5h
    expect(schedule.noteRequired("2026-07-16T09:00", "2026-07-16T11:00")).toBe(
      true,
    ); // exactly 2h
    expect(schedule.noteRequired("2026-07-16T09:00", "2026-07-16T10:59")).toBe(
      false,
    ); // under 2h
  });

  it("respects an AUTO_APPROVE_MAX_HOURS override", () => {
    vi.stubEnv("AUTO_APPROVE_MAX_HOURS", "1");
    expect(schedule.needsApproval("2026-07-16T09:00", "2026-07-16T10:30")).toBe(
      true,
    );
    expect(schedule.noteRequired("2026-07-16T09:00", "2026-07-16T10:00")).toBe(
      true,
    );
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
    expect(schedule.isValidTimeOfDay(0)).toBe(true); // 00:00, the day's first minute
    expect(schedule.isValidTimeOfDay(3 * 60 + 5)).toBe(true); // 03:05, the small hours
    expect(schedule.isValidTimeOfDay(9 * 60)).toBe(true);
    expect(schedule.isValidTimeOfDay(23 * 60 + 55)).toBe(true); // the last step
    expect(schedule.isValidTimeOfDay(9 * 60 + 7)).toBe(false); // 09:07 off grid
    expect(schedule.isValidTimeOfDay(24 * 60)).toBe(false); // 24:00 is not a time
    expect(schedule.isValidTimeOfDay(-5)).toBe(false);
    expect(schedule.isValidTimeOfDay(9.5 as unknown as number)).toBe(false); // non-integer
  });

  it("honours a TIME_STEP_MINUTES override, which also moves the last step", () => {
    vi.stubEnv("TIME_STEP_MINUTES", "15");
    expect(schedule.isValidTimeOfDay(8 * 60)).toBe(true);
    expect(schedule.isValidTimeOfDay(8 * 60 + 5)).toBe(false); // off the 15-min grid
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
    vi.stubEnv("TIME_STEP_MINUTES", "7"); // does not divide 60
    expect(() => schedule.stepMinutes()).toThrow();
    vi.stubEnv("TIME_STEP_MINUTES", "90"); // over 60
    expect(() => schedule.stepMinutes()).toThrow();
  });
});

describe("reservation window", () => {
  it("treats today as reservable and rejects malformed or out-of-window dates", () => {
    const today = todayYMD();
    expect(schedule.isReservableDate(today)).toBe(true);
    expect(schedule.isReservableDate("not-a-date")).toBe(false);
    expect(schedule.isReservableDate("1999-01-01")).toBe(false); // in the past
    expect(schedule.isReservableDate(undefined)).toBe(false);
    expect(schedule.reservableDates()[0]).toBe(today); // window starts today
  });
});
