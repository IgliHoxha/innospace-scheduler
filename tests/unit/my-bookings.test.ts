import { describe, expect, it } from "vitest";
import {
  canCancel,
  canChangeEnd,
  earliestEndMin,
  longStayMessage,
  phaseOf,
} from "@/lib/my-bookings";

const D = "2026-07-16";
const at = (t: string) => `${D}T${t}`;

describe("phaseOf", () => {
  it("is upcoming before the start", () => {
    expect(phaseOf(at("10:00"), at("11:00"), at("09:59"))).toBe("upcoming");
  });

  it("is ongoing from the start minute itself", () => {
    expect(phaseOf(at("10:00"), at("11:00"), at("10:00"))).toBe("ongoing");
    expect(phaseOf(at("10:00"), at("11:00"), at("10:59"))).toBe("ongoing");
  });

  // Half-open, like every range here: the end minute already belongs to the next booking.
  it("is past from the end minute on", () => {
    expect(phaseOf(at("10:00"), at("11:00"), at("11:00"))).toBe("past");
  });

  it("compares across days as plain text", () => {
    expect(phaseOf(at("10:00"), at("11:00"), "2026-07-15T23:00")).toBe(
      "upcoming",
    );
    expect(phaseOf(at("10:00"), at("11:00"), "2026-07-17T00:00")).toBe("past");
  });
});

describe("what a member may do", () => {
  it("cancels only an active booking that has not started", () => {
    expect(canCancel({ status: "confirmed", phase: "upcoming" })).toBe(true);
    expect(canCancel({ status: "pending", phase: "upcoming" })).toBe(true);
    expect(canCancel({ status: "cancelled", phase: "upcoming" })).toBe(false);
    expect(canCancel({ status: "confirmed", phase: "ongoing" })).toBe(false);
    expect(canCancel({ status: "confirmed", phase: "past" })).toBe(false);
  });

  it("moves the end only of an active booking under way", () => {
    expect(canChangeEnd({ status: "confirmed", phase: "ongoing" })).toBe(true);
    expect(canChangeEnd({ status: "pending", phase: "ongoing" })).toBe(true);
    expect(canChangeEnd({ status: "cancelled", phase: "ongoing" })).toBe(false);
    expect(canChangeEnd({ status: "confirmed", phase: "upcoming" })).toBe(
      false,
    );
    expect(canChangeEnd({ status: "confirmed", phase: "past" })).toBe(false);
  });
});

describe("earliestEndMin", () => {
  it("is the next grid step after now", () => {
    expect(earliestEndMin(600, 642, 5, 15)).toBe(645);
  });

  it("moves a whole step on when now sits on the grid", () => {
    expect(earliestEndMin(600, 640, 5, 15)).toBe(645);
  });

  it("never leaves the booking shorter than the minimum", () => {
    expect(earliestEndMin(600, 601, 5, 30)).toBe(630);
  });
});

describe("longStayMessage", () => {
  it("names what the longer stay would need", () => {
    expect(longStayMessage(2, true)).toBe(
      "A stay of 2 hours or more needs admin approval, so it can't be extended here. Reserve the extra time from the form instead.",
    );
    expect(longStayMessage(2, false)).toContain("needs a note");
  });
});
