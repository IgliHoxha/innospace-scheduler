import { describe, expect, it } from "vitest";
import * as u from "@/lib/time-picker-utils";

describe("getValidNumber", () => {
  it("clamps out-of-range values and pads to two digits", () => {
    expect(u.getValidNumber("30", { max: 23 })).toBe("23");
    expect(u.getValidNumber("-5", { max: 23 })).toBe("00");
    expect(u.getValidNumber("5", { max: 23 })).toBe("05");
    expect(u.getValidNumber("abc", { max: 23 })).toBe("00");
  });

  it("loops past the ends when loop is on", () => {
    expect(u.getValidNumber("24", { max: 23, min: 0, loop: true })).toBe("00");
    expect(u.getValidNumber("-1", { max: 23, min: 0, loop: true })).toBe("23");
  });
});

describe("hour / minute validators", () => {
  it("caps hours at 23 and minutes at 59", () => {
    expect(u.getValidHour("25")).toBe("23");
    expect(u.getValidMinute("70")).toBe("59");
    expect(u.getValidHour("9")).toBe("09");
  });
});

describe("arrow stepping (loops within range)", () => {
  it("steps hours and minutes, wrapping at the boundary", () => {
    expect(u.getValidArrowHour("23", 1)).toBe("00");
    expect(u.getValidArrowHour("00", -1)).toBe("23");
    // Below-min wraps straight to the max (a single boundary hop, not modulo).
    expect(u.getValidArrowMinute("00", -5)).toBe("59");
    expect(u.getValidArrowMinute("55", 5)).toBe("00");
    expect(u.getValidArrowMinute("abc", 5)).toBe("00"); // non-numeric input
  });
});

describe("date <-> field helpers", () => {
  it("reads and writes the hours/minutes of a Date by type", () => {
    const d = new Date(2026, 6, 16, 9, 5, 0);
    expect(u.getDateByType(d, "hours")).toBe("09");
    expect(u.getDateByType(d, "minutes")).toBe("05");

    u.setDateByType(d, "14", "hours");
    u.setDateByType(d, "30", "minutes");
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it("getArrowByType dispatches to the right stepper", () => {
    expect(u.getArrowByType("09", 1, "hours")).toBe("10");
    expect(u.getArrowByType("55", 5, "minutes")).toBe("00");
  });
});

describe("isCompleteEntry", () => {
  // Two digits are always the whole value.
  it("treats two digits as finished", () => {
    expect(u.isCompleteEntry("13", "hours")).toBe(true);
    expect(u.isCompleteEntry("00", "minutes")).toBe(true);
  });

  // One digit is finished only when nothing could legally follow it.
  it("waits on a digit that could still take a second", () => {
    expect(u.isCompleteEntry("1", "hours")).toBe(false); // 10-19 exist
    expect(u.isCompleteEntry("2", "hours")).toBe(false); // 20-23 exist
    expect(u.isCompleteEntry("5", "minutes")).toBe(false); // 50-59 exist
  });

  it("finishes on a digit no second digit could follow", () => {
    expect(u.isCompleteEntry("3", "hours")).toBe(true); // 30-39 is not an hour
    expect(u.isCompleteEntry("9", "hours")).toBe(true);
    expect(u.isCompleteEntry("6", "minutes")).toBe(true); // 60-69 is not a minute
  });

  it("is not finished on an empty field", () => {
    expect(u.isCompleteEntry("", "hours")).toBe(false);
  });
});
