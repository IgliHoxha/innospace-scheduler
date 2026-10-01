import { describe, expect, it } from "vitest";
import {
  approvalRequiredFor,
  dayEndMinute,
  findOverlap,
  isBookableMinute,
  meetsMinDuration,
  noteRequiredFor,
  runTotalMinutes,
} from "@/lib/reservation-rules";

describe("dayEndMinute", () => {
  it("is the last grid step before midnight, whatever the step", () => {
    expect(dayEndMinute(5)).toBe(23 * 60 + 55);
    expect(dayEndMinute(15)).toBe(23 * 60 + 45);
    expect(dayEndMinute(30)).toBe(23 * 60 + 30);
    expect(dayEndMinute(60)).toBe(23 * 60);
  });
});

describe("isBookableMinute", () => {
  it("accepts a time on the grid at any hour, since nothing is closed", () => {
    expect(isBookableMinute(9 * 60, 5)).toBe(true);
    expect(isBookableMinute(9 * 60 + 55, 5)).toBe(true);
    expect(isBookableMinute(3 * 60 + 10, 5)).toBe(true);
    expect(isBookableMinute(22 * 60 + 30, 5)).toBe(true);
  });
  it("rejects a time off the step grid", () => {
    expect(isBookableMinute(9 * 60 + 7, 5)).toBe(false);
  });
  it("includes both ends of the day: midnight and the last step", () => {
    expect(isBookableMinute(0, 5)).toBe(true);
    expect(isBookableMinute(23 * 60 + 55, 5)).toBe(true);
  });
  // "24:00" sits on the grid, so only the bound keeps it out.
  it("rejects 24:00 and anything past it, which no clock can show", () => {
    expect(isBookableMinute(24 * 60, 5)).toBe(false);
    expect(isBookableMinute(24 * 60 + 5, 5)).toBe(false);
  });
  it("rejects a negative minute", () => {
    expect(isBookableMinute(-5, 5)).toBe(false);
  });
  it("moves the last bookable minute with the step", () => {
    expect(isBookableMinute(23 * 60 + 45, 15)).toBe(true);
    expect(isBookableMinute(23 * 60 + 30, 30)).toBe(true);
    expect(isBookableMinute(23 * 60, 60)).toBe(true);
    expect(isBookableMinute(24 * 60, 60)).toBe(false);
  });
  it("rejects a non-integer minute", () => {
    expect(isBookableMinute(9.5 * 60 + 0.5, 5)).toBe(false);
  });
});

describe("meetsMinDuration", () => {
  it("is inclusive of the minimum", () => {
    expect(meetsMinDuration(15, 15)).toBe(true);
    expect(meetsMinDuration(14, 15)).toBe(false);
    expect(meetsMinDuration(60, 15)).toBe(true);
  });
});

describe("note / approval thresholds", () => {
  // The 2 is autoApproveMaxHours, so the limit is 120 minutes.
  it("note is required at or over the threshold", () => {
    expect(noteRequiredFor(119, 2)).toBe(false);
    expect(noteRequiredFor(120, 2)).toBe(true);
    expect(noteRequiredFor(121, 2)).toBe(true);
  });
  it("approval is required only over the threshold", () => {
    expect(approvalRequiredFor(120, 2)).toBe(false);
    expect(approvalRequiredFor(121, 2)).toBe(true);
  });
});

describe("findOverlap", () => {
  const reserved = [
    { start: 600, end: 660, label: "10:00 - 11:00" },
    { start: 780, end: 840, label: "13:00 - 14:00" },
  ];
  it("finds an overlapping range and returns it (with its extra fields)", () => {
    expect(findOverlap(630, 690, reserved)?.label).toBe("10:00 - 11:00");
  });
  it("treats touching edges as non-overlapping (half-open)", () => {
    expect(findOverlap(660, 720, reserved)).toBeNull();
    expect(findOverlap(540, 600, reserved)).toBeNull();
  });
  it("returns null when the slot is free", () => {
    expect(findOverlap(660, 780, reserved)).toBeNull();
  });
});

describe("runTotalMinutes", () => {
  const held = (...pairs: [number, number][]) =>
    pairs.map(([start, end]) => ({ start, end }));

  it("is just the reservation when nothing else is held", () => {
    expect(runTotalMinutes(600, 660, [])).toBe(60);
  });

  it("ignores bookings that do not touch it", () => {
    expect(runTotalMinutes(600, 660, held([840, 900]))).toBe(60);
  });

  it("adds a booking that ends exactly where this one starts", () => {
    expect(runTotalMinutes(600, 660, held([540, 600]))).toBe(120);
  });

  it("adds one that starts exactly where this one ends", () => {
    expect(runTotalMinutes(600, 660, held([660, 720]))).toBe(120);
  });

  it("counts a run reached through another booking", () => {
    expect(runTotalMinutes(660, 720, held([540, 600], [600, 660]))).toBe(180);
  });

  it("chains in both directions at once", () => {
    expect(runTotalMinutes(600, 660, held([540, 600], [660, 720]))).toBe(180);
  });

  it("treats a gap too small to book as no break at all", () => {
    expect(runTotalMinutes(605, 665, held([540, 600]), 15)).toBe(120);
  });

  it("lets a real gap break the run", () => {
    expect(runTotalMinutes(660, 720, held([540, 600]), 15)).toBe(60);
  });

  it("sums booked time, not the span the run covers", () => {
    // 09:00-10:00 then 10:10-11:10 is 2 hours booked across 2h10m of clock.
    expect(runTotalMinutes(610, 670, held([540, 600]), 15)).toBe(120);
  });

  it("ignores an overlapping booking, which is a clash and not a run", () => {
    expect(runTotalMinutes(870, 930, held([840, 900]), 15)).toBe(60);
  });

  // The far one is in reach on its own, so it must not swallow the one between.
  it("counts a short booking that fills the gap to a reachable neighbour", () => {
    expect(runTotalMinutes(915, 965, held([840, 900], [900, 915]), 15)).toBe(
      125,
    );
    expect(runTotalMinutes(840, 900, held([900, 915], [915, 965]), 15)).toBe(
      125,
    );
  });

  it("counts a chain of short bookings in full, however it is ordered", () => {
    const slices: [number, number][] = [
      [840, 855],
      [855, 870],
      [870, 885],
      [885, 900],
    ];
    expect(runTotalMinutes(900, 915, held(...slices), 15)).toBe(75);
    expect(runTotalMinutes(900, 915, held(...[...slices].reverse()), 15)).toBe(
      75,
    );
  });

  // Joining a neighbour extends the reach by its length, never past a break.
  it("stops at the first gap nobody could have filled", () => {
    expect(runTotalMinutes(915, 965, held([840, 900], [1080, 1140]), 15)).toBe(
      110,
    );
    expect(runTotalMinutes(915, 965, held([840, 900], [990, 1050]), 15)).toBe(
      110,
    );
  });

  it("ignores a zero-length row rather than looping on it", () => {
    expect(runTotalMinutes(600, 660, held([600, 600]))).toBe(60);
  });

  it("counts held time once even if a row somehow appears twice", () => {
    // The second copy overlaps the run the first made, so it adds nothing.
    expect(runTotalMinutes(600, 660, held([540, 600], [540, 600]))).toBe(120);
  });
});
