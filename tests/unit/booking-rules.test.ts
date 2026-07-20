import { describe, expect, it } from "vitest";
import {
  approvalRequiredFor,
  findOverlap,
  meetsMinDuration,
  noteRequiredFor,
} from "@/lib/booking-rules";

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
  const booked = [
    { start: 600, end: 660, label: "10:00 – 11:00" },
    { start: 780, end: 840, label: "13:00 – 14:00" },
  ];
  it("finds an overlapping range and returns it (with its extra fields)", () => {
    expect(findOverlap(630, 690, booked)?.label).toBe("10:00 – 11:00");
  });
  it("treats touching edges as non-overlapping (half-open)", () => {
    expect(findOverlap(660, 720, booked)).toBeNull(); // starts exactly when 10–11 ends
    expect(findOverlap(540, 600, booked)).toBeNull(); // ends exactly when 10–11 starts
  });
  it("returns null when the slot is free", () => {
    expect(findOverlap(660, 780, booked)).toBeNull();
  });
});
