import { describe, expect, it } from "vitest";
import {
  checkBooking,
  isBlocking,
  noteRequiredMessage,
  type BookingCheckInput,
} from "@/lib/booking-check";

// Mirrors the test baseline: 09:00-18:00, 5-minute grid, 15-minute minimum, 2-hour approval limit.
const base: BookingCheckInput = {
  startMin: 10 * 60,
  endMin: 11 * 60,
  openMin: 9 * 60,
  closeMin: 18 * 60,
  earliestMin: 9 * 60,
  reserved: [],
  held: [],
  note: "",
  stepMinutes: 5,
  minReservationMinutes: 15,
  autoApproveMaxHours: 2,
};

const check = (over: Partial<BookingCheckInput> = {}) =>
  checkBooking({ ...base, ...over });

describe("checkBooking: nothing chosen yet", () => {
  it("says nothing until both ends are picked", () => {
    expect(check({ startMin: null }).problem).toBe("");
    expect(check({ endMin: null }).problem).toBe("");
    expect(check({ startMin: null, endMin: null }).problem).toBe("");
  });

  it("reports no run and no note when nothing is chosen", () => {
    const r = check({ startMin: null, endMin: null });
    expect(r).toMatchObject({
      runMinutes: 0,
      partOfRun: false,
      mustNote: false,
      needsApproval: false,
    });
  });
});

describe("checkBooking: the happy path", () => {
  it("passes a clean one-hour booking", () => {
    expect(check()).toMatchObject({
      problem: "",
      field: undefined,
      runMinutes: 60,
      partOfRun: false,
      mustNote: false,
      needsApproval: false,
    });
  });
});

describe("checkBooking: the grid and opening hours", () => {
  it("refuses a start off the step grid", () => {
    expect(check({ startMin: 10 * 60 + 7 }).problem).toContain(
      "5-minute steps",
    );
  });

  it("refuses an end off the step grid", () => {
    expect(check({ endMin: 11 * 60 + 3 }).problem).toContain("5-minute steps");
  });

  it("refuses a start before opening and an end after closing", () => {
    expect(check({ startMin: 8 * 60, endMin: 9 * 60 }).problem).toContain(
      "opening hours",
    );
    expect(check({ startMin: 17 * 60, endMin: 19 * 60 }).problem).toContain(
      "opening hours",
    );
  });

  it("allows a booking ending exactly at closing time", () => {
    expect(check({ startMin: 17 * 60, endMin: 18 * 60 }).problem).toBe("");
  });
});

describe("checkBooking: duration", () => {
  it("refuses an end at or before the start", () => {
    expect(check({ endMin: 10 * 60 }).problem).toBe(
      "The end time must be after the start time.",
    );
    expect(check({ endMin: 9 * 60 }).problem).toBe(
      "The end time must be after the start time.",
    );
  });

  it("refuses anything under the minimum", () => {
    expect(check({ endMin: 10 * 60 + 10 }).problem).toContain(
      "at least 15 minutes",
    );
  });

  it("allows exactly the minimum", () => {
    expect(check({ endMin: 10 * 60 + 15 }).problem).toBe("");
  });
});

describe("checkBooking: already passed", () => {
  it("refuses a start before the earliest reservable minute", () => {
    expect(check({ earliestMin: 10 * 60 + 5 }).problem).toBe(
      "That time has already passed.",
    );
  });

  it("allows a start exactly at the earliest minute", () => {
    expect(check({ earliestMin: 10 * 60 }).problem).toBe("");
  });
});

describe("checkBooking: clashes", () => {
  const taken = [{ start: 10 * 60 + 30, end: 12 * 60, label: "10:30 - 12:00" }];

  it("names the reservation it overlaps", () => {
    expect(check({ reserved: taken }).problem).toBe(
      "That overlaps an existing reservation (10:30 - 12:00).",
    );
  });

  // Half-open ranges: 10:00-11:00 and 11:00-12:00 are neighbours, not a clash.
  it("allows a booking that only touches an existing one", () => {
    const after = [{ start: 11 * 60, end: 12 * 60, label: "11:00 - 12:00" }];
    expect(check({ reserved: after }).problem).toBe("");
  });

  it("refuses holding two booths at once, using this browser's own bookings", () => {
    expect(
      check({ held: [{ start: 10 * 60 + 30, end: 12 * 60 }] }).problem,
    ).toBe("You already have a reservation during that time.");
  });
});

describe("checkBooking: the note rule", () => {
  it("demands a note at exactly the threshold, and names the field", () => {
    const r = check({ endMin: 12 * 60 }); // 2 hours
    expect(r.mustNote).toBe(true);
    expect(r.field).toBe("note");
    expect(r.problem).toBe(noteRequiredMessage(false, 2));
  });

  it("accepts the booking once a note is written", () => {
    const r = check({ endMin: 12 * 60, note: "Board meeting" });
    expect(r.problem).toBe("");
    expect(r.field).toBeUndefined();
  });

  it("treats a whitespace-only note as no note", () => {
    expect(check({ endMin: 12 * 60, note: "   " }).field).toBe("note");
  });

  it("needs no note just under the threshold", () => {
    const r = check({ endMin: 11 * 60 + 55 });
    expect(r.mustNote).toBe(false);
    expect(r.problem).toBe("");
  });
});

// The picker re-seeds itself after a booking, so a live note error scolds a range nobody chose.
describe("isBlocking", () => {
  it("does not block on a missing note, which waits for the reserve press", () => {
    const r = check({ endMin: 12 * 60 });
    expect(r.field).toBe("note");
    expect(r.problem).not.toBe("");
    expect(isBlocking(r)).toBe(false);
  });

  it("blocks on every problem about the times themselves", () => {
    for (const over of [
      { startMin: 10 * 60 + 7 }, // off the grid
      { endMin: 10 * 60 }, // end not after start
      { endMin: 10 * 60 + 10 }, // under the minimum
      { earliestMin: 11 * 60 }, // already passed
      { reserved: [{ start: 10 * 60, end: 11 * 60, label: "x" }] }, // clash
      { held: [{ start: 10 * 60, end: 11 * 60 }] }, // two booths at once
    ]) {
      expect(isBlocking(check(over))).toBe(true);
    }
  });

  it("does not block a clean booking", () => {
    expect(isBlocking(check())).toBe(false);
    expect(isBlocking(check({ endMin: 12 * 60, note: "Board meeting" }))).toBe(
      false,
    );
  });
});

describe("checkBooking: approval", () => {
  it("needs approval over the limit, but not at it", () => {
    expect(check({ endMin: 12 * 60, note: "x" }).needsApproval).toBe(false);
    expect(check({ endMin: 12 * 60 + 5, note: "x" }).needsApproval).toBe(true);
  });
});

describe("checkBooking: the back-to-back run", () => {
  // A booking that is fine alone can still cross the limit joined to a neighbour.
  it("counts an adjacent booking into the run and then demands a note", () => {
    const r = check({ held: [{ start: 9 * 60, end: 10 * 60 }] });
    expect(r.runMinutes).toBe(120);
    expect(r.partOfRun).toBe(true);
    expect(r.mustNote).toBe(true);
    expect(r.field).toBe("note");
    expect(r.problem).toBe(noteRequiredMessage(true, 2));
  });

  it("words the message differently when a run is what pushed it over", () => {
    expect(noteRequiredMessage(true, 2)).toContain("back to back");
    expect(noteRequiredMessage(false, 2)).not.toContain("back to back");
    expect(noteRequiredMessage(false, 3)).toContain("3 hours");
  });

  it("bridges a gap no one else could book, since that is not a real break", () => {
    // 15-minute gap, exactly the minimum, so nobody could take it.
    const r = check({ held: [{ start: 8 * 60 + 30, end: 9 * 60 + 45 }] });
    expect(r.partOfRun).toBe(true);
    expect(r.runMinutes).toBe(135);
  });

  it("leaves a genuinely separate booking out of the run", () => {
    const r = check({ held: [{ start: 14 * 60, end: 15 * 60 }] });
    expect(r.runMinutes).toBe(60);
    expect(r.partOfRun).toBe(false);
    expect(r.mustNote).toBe(false);
  });

  it("reports the clash before the run rule, since overlapping is the worse problem", () => {
    const r = check({ held: [{ start: 10 * 60 + 30, end: 13 * 60 }] });
    expect(r.problem).toBe("You already have a reservation during that time.");
  });
});

describe("checkBooking: the route's own order", () => {
  // The form must fail on the same rule the route would, or it reports a problem the server won't.
  it("reports the grid before the ordering, and the ordering before the minimum", () => {
    expect(check({ startMin: 10 * 60 + 7, endMin: 9 * 60 }).problem).toContain(
      "5-minute steps",
    );
    expect(check({ endMin: 9 * 60 }).problem).toContain("after the start time");
  });

  it("reports a passed time before a clash", () => {
    const r = check({
      earliestMin: 11 * 60,
      reserved: [{ start: 10 * 60, end: 11 * 60, label: "10:00 - 11:00" }],
    });
    expect(r.problem).toBe("That time has already passed.");
  });

  // Both rules fire at once here, so this is what actually pins the order down.
  it("reports a clash before the missing note, the time being the worse problem", () => {
    const r = check({
      endMin: 12 * 60, // 2 hours, so a note is required too
      reserved: [{ start: 11 * 60, end: 13 * 60, label: "11:00 - 13:00" }],
    });
    expect(r.mustNote).toBe(true);
    expect(r.problem).toBe(
      "That overlaps an existing reservation (11:00 - 13:00).",
    );
    expect(r.field).toBeUndefined();
  });

  it("reports holding two booths before the missing note", () => {
    const r = check({
      endMin: 12 * 60,
      held: [{ start: 11 * 60, end: 13 * 60 }],
    });
    expect(r.mustNote).toBe(true);
    expect(r.problem).toBe("You already have a reservation during that time.");
    expect(r.field).toBeUndefined();
  });
});
