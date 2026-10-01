import { describe, expect, it } from "vitest";
import {
  attemptKey,
  checkBooking,
  isBlocking,
  noteAsk,
  noteRequiredMessage,
  NO_VERDICTS,
  verdictFor,
  withVerdict,
  type Attempt,
  type BookingCheckInput,
} from "@/lib/booking-check";

const ada: Attempt = {
  boothId: "booth-1",
  date: "2026-07-16",
  start: "22:00",
  end: "23:55",
  booker: "ada@example.com",
};

describe("attemptKey", () => {
  it("gives the same key for the same attempt", () => {
    expect(attemptKey({ ...ada })).toBe(attemptKey(ada));
  });

  it("changes when the booth, the date, either time or the booker changes", () => {
    const others: Attempt = {
      boothId: "booth-2",
      date: "2026-07-17",
      start: "21:00",
      end: "23:00",
      booker: "bob@example.com",
    };
    for (const part of Object.keys(others) as (keyof Attempt)[]) {
      expect(attemptKey({ ...ada, [part]: others[part] })).not.toBe(
        attemptKey(ada),
      );
    }
  });

  // The note is what the server asks for, so writing one must not void its demand.
  it("ignores everything that is not part of the attempt, the note included", () => {
    const withNote = { ...ada, note: "Board meeting", fullName: "Ada L" };
    expect(attemptKey(withNote)).toBe(attemptKey(ada));
  });

  it("tells a swapped start and end apart", () => {
    expect(attemptKey({ ...ada, start: ada.end, end: ada.start })).not.toBe(
      attemptKey(ada),
    );
  });

  it("is exact about letter case, leaving the canonical form to the caller", () => {
    expect(attemptKey({ ...ada, booker: "ADA@example.com" })).not.toBe(
      attemptKey(ada),
    );
  });

  // Joined with a bare separator, these two would be one key.
  it("keeps a value from running into its neighbour", () => {
    expect(attemptKey({ ...ada, boothId: "a|b", date: "c" })).not.toBe(
      attemptKey({ ...ada, boothId: "a", date: "b|c" }),
    );
    expect(attemptKey({ ...ada, start: "", end: "09:00" })).not.toBe(
      attemptKey({ ...ada, start: "09:00", end: "" }),
    );
  });
});

describe("verdictFor and withVerdict", () => {
  const attempt = attemptKey(ada);
  const later = attemptKey({ ...ada, start: "12:00", end: "13:00" });
  const one = withVerdict(NO_VERDICTS, attempt, "Please add a note.");

  it("gives the message back for the very attempt it judged", () => {
    expect(verdictFor(one, attempt)).toBe("Please add a note.");
  });

  it("has nothing to say about an attempt nobody judged", () => {
    expect(verdictFor(NO_VERDICTS, attempt)).toBe("");
    expect(verdictFor(one, later)).toBe("");
    expect(verdictFor(one, "")).toBe("");
  });

  it("does not match on a prefix or a longer attempt", () => {
    expect(verdictFor(one, attempt.slice(0, -1))).toBe("");
    expect(verdictFor(one, `${attempt}x`)).toBe("");
  });

  // Going back to the first pick must not send the refused request again.
  it("keeps an earlier verdict when a later attempt is refused too", () => {
    const two = withVerdict(one, later, "Add a note for this one too.");
    expect(verdictFor(two, attempt)).toBe("Please add a note.");
    expect(verdictFor(two, later)).toBe("Add a note for this one too.");
  });

  it("lets the newest word on an attempt replace the older one", () => {
    const again = withVerdict(one, attempt, "Still needs a note.");
    expect(verdictFor(again, attempt)).toBe("Still needs a note.");
  });

  // React state: a changed map must be a new one, and the old one untouched.
  it("returns a new collection and leaves the one it was given alone", () => {
    const two = withVerdict(one, later, "x");
    expect(two).not.toBe(one);
    expect(verdictFor(one, later)).toBe("");
    expect(NO_VERDICTS.size).toBe(0);
  });
});

// The test baseline: 5-minute grid, 15-minute minimum, 2-hour limit.
const base: BookingCheckInput = {
  startMin: 10 * 60,
  endMin: 11 * 60,
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

describe("checkBooking: the grid and the clock", () => {
  it("refuses a start off the step grid", () => {
    expect(check({ startMin: 10 * 60 + 7 }).problem).toContain(
      "5-minute steps",
    );
  });

  it("refuses an end off the step grid", () => {
    expect(check({ endMin: 11 * 60 + 3 }).problem).toContain("5-minute steps");
  });

  it("accepts the small hours and the late evening, since nothing is closed", () => {
    expect(check({ startMin: 0, endMin: 60, earliestMin: 0 }).problem).toBe("");
    expect(
      check({ startMin: 6 * 60, endMin: 7 * 60, earliestMin: 0 }).problem,
    ).toBe("");
    expect(check({ startMin: 22 * 60, endMin: 23 * 60 }).problem).toBe("");
  });

  it("allows a booking ending on the day's last step", () => {
    expect(check({ startMin: 23 * 60, endMin: 23 * 60 + 55 }).problem).toBe("");
  });

  // 24:00 is on the grid but is not a clock time, so the day stops a step short.
  it("refuses an end at 24:00", () => {
    expect(check({ startMin: 23 * 60, endMin: 24 * 60 }).problem).toContain(
      "5-minute steps",
    );
  });

  it("never mentions opening hours", () => {
    expect(check({ startMin: 10 * 60 + 7 }).problem).not.toContain("opening");
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

// What holds a Reserve press back at the note box, and what it says there.
describe("noteAsk", () => {
  const demand = "Please add a note - back to back this comes to 2 hours.";

  it("asks nothing of a clean booking the server has not judged", () => {
    expect(noteAsk(check(), "", "")).toBe("");
    expect(noteAsk(check({ note: "hello" }), "", "hello")).toBe("");
  });

  it("gives the form's own ask when the form can see a note is needed", () => {
    const r = check({ endMin: 12 * 60 });
    expect(noteAsk(r, "", "")).toBe(noteRequiredMessage(false, 2));
  });

  // The server counts days this board cannot see, so the form alone says nothing.
  it("gives the server's demand while the note is still empty", () => {
    expect(check().mustNote).toBe(false);
    expect(noteAsk(check(), demand, "")).toBe(demand);
  });

  it("treats a whitespace-only note as still empty", () => {
    expect(noteAsk(check({ note: " \n " }), demand, " \n ")).toBe(demand);
  });

  it("lets the press through once a note is written, demand or not", () => {
    expect(noteAsk(check({ note: "Client call" }), demand, "Client call")).toBe(
      "",
    );
    const long = check({ endMin: 12 * 60, note: "Board meeting" });
    expect(noteAsk(long, demand, "Board meeting")).toBe("");
  });

  it("puts the form's own wording first when both ask", () => {
    const r = check({ endMin: 12 * 60 });
    expect(noteAsk(r, demand, "")).toBe(noteRequiredMessage(false, 2));
  });

  // A clash is said by the button; the note box must not speak for it.
  it("stays silent about problems that are not the note's", () => {
    const clash = check({
      reserved: [{ start: 10 * 60, end: 11 * 60, label: "10:00 - 11:00" }],
    });
    expect(clash.problem).not.toBe("");
    expect(noteAsk(clash, "", "")).toBe("");
  });
});

// The picker re-seeds after a booking, so a live note error scolds nobody.
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
  // The form must fail on the rule the route would, or it invents a problem.
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
