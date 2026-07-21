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

describe("isValidTimeOfDay", () => {
  it("enforces the step grid and opening window (defaults 09-18, step 5)", () => {
    expect(schedule.isValidTimeOfDay(9 * 60)).toBe(true); // 09:00 opening
    expect(schedule.isValidTimeOfDay(18 * 60)).toBe(true); // 18:00 closing
    expect(schedule.isValidTimeOfDay(9 * 60 + 5)).toBe(true); // 09:05 on grid
    expect(schedule.isValidTimeOfDay(9 * 60 + 7)).toBe(false); // 09:07 off grid
    expect(schedule.isValidTimeOfDay(8 * 60 + 55)).toBe(false); // before open
    expect(schedule.isValidTimeOfDay(18 * 60 + 5)).toBe(false); // after close
    expect(schedule.isValidTimeOfDay(9.5 as unknown as number)).toBe(false); // non-integer
  });

  it("honours OPEN_HOUR / CLOSE_HOUR / TIME_STEP_MINUTES overrides", () => {
    vi.stubEnv("OPEN_HOUR", "8");
    vi.stubEnv("CLOSE_HOUR", "20");
    vi.stubEnv("TIME_STEP_MINUTES", "15");
    expect(schedule.isValidTimeOfDay(8 * 60)).toBe(true);
    expect(schedule.isValidTimeOfDay(8 * 60 + 5)).toBe(false); // off the 15-min grid
    expect(schedule.isValidTimeOfDay(8 * 60 + 15)).toBe(true);
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
