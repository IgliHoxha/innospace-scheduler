import { describe, expect, it } from "vitest";
import {
  approvalRequiredFor,
  findOverlap,
  isBookableMinute,
  meetsMinDuration,
  noteRequiredFor,
  runTotalMinutes,
} from "@/lib/reservation-rules";

describe("isBookableMinute", () => {
  const open = 8 * 60;
  const close = 23 * 60;
  it("accepts a time on the grid inside the window", () => {
    expect(isBookableMinute(9 * 60, open, close, 5)).toBe(true);
    expect(isBookableMinute(9 * 60 + 55, open, close, 5)).toBe(true);
  });
  it("rejects a time off the step grid", () => {
    expect(isBookableMinute(9 * 60 + 7, open, close, 5)).toBe(false);
  });
  it("rejects a time outside opening hours", () => {
    expect(isBookableMinute(open - 5, open, close, 5)).toBe(false);
    expect(isBookableMinute(close + 5, open, close, 5)).toBe(false);
  });
  it("includes both ends of the window, so a booking may close the day", () => {
    expect(isBookableMinute(open, open, close, 5)).toBe(true);
    expect(isBookableMinute(close, open, close, 5)).toBe(true);
  });
  it("rejects a non-integer minute", () => {
    expect(isBookableMinute(9.5 * 60 + 0.5, open, close, 5)).toBe(false);
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
  // autoApproveMaxHours = 2 → 120 minutes. Note at >=120, approval at >120.
  it("note is required at or over the threshold", () => {
    expect(noteRequiredFor(119, 2)).toBe(false);
    expect(noteRequiredFor(120, 2)).toBe(true);
    expect(noteRequiredFor(121, 2)).toBe(true);
  });
  it("approval is required only over the threshold", () => {
    expect(approvalRequiredFor(120, 2)).toBe(false); // exactly the limit auto-confirms
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
    expect(findOverlap(660, 720, reserved)).toBeNull(); // starts exactly when 10-11 ends
    expect(findOverlap(540, 600, reserved)).toBeNull(); // ends exactly when 10-11 starts
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
    // 10:00-11:00 alongside a 14:00-15:00 held elsewhere in the day.
    expect(runTotalMinutes(600, 660, held([840, 900]))).toBe(60);
  });

  it("adds a booking that ends exactly where this one starts", () => {
    expect(runTotalMinutes(600, 660, held([540, 600]))).toBe(120);
  });

  it("adds one that starts exactly where this one ends", () => {
    expect(runTotalMinutes(600, 660, held([660, 720]))).toBe(120);
  });

  it("counts a run reached through another booking", () => {
    // 09:00-10:00 + 10:00-11:00 held, booking 11:00-12:00: all three chain.
    expect(runTotalMinutes(660, 720, held([540, 600], [600, 660]))).toBe(180);
  });

  it("chains in both directions at once", () => {
    expect(runTotalMinutes(600, 660, held([540, 600], [660, 720]))).toBe(180);
  });

  it("treats a gap too small to book as no break at all", () => {
    // 5 minutes clear, which nobody else could reserve: still one sitting.
    expect(runTotalMinutes(605, 665, held([540, 600]), 15)).toBe(120);
  });

  it("lets a real gap break the run", () => {
    // A clear hour between them, so the earlier booking doesn't count.
    expect(runTotalMinutes(660, 720, held([540, 600]), 15)).toBe(60);
  });

  it("sums booked time, not the span the run covers", () => {
    // 09:00-10:00 then 10:10-11:10 is 2 hours booked across 2h10m of clock.
    expect(runTotalMinutes(610, 670, held([540, 600]), 15)).toBe(120);
  });

  it("ignores an overlapping booking, which is a clash and not a run", () => {
    // 14:30-15:30 over a held 14:00-15:00: double booking, not a longer sitting.
    expect(runTotalMinutes(870, 930, held([840, 900]), 15)).toBe(60);
  });

  it("ignores a zero-length row rather than looping on it", () => {
    expect(runTotalMinutes(600, 660, held([600, 600]))).toBe(60);
  });

  it("counts held time once even if a row somehow appears twice", () => {
    // The second copy overlaps the run the first made, so it adds nothing.
    expect(runTotalMinutes(600, 660, held([540, 600], [540, 600]))).toBe(120);
  });
});
