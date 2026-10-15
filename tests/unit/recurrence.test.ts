import { describe, expect, it } from "vitest";
import {
  MAX_REPEAT_WEEKS,
  parseRepeatWeeks,
  REPEAT_SIGN_IN_MESSAGE,
  repeatLabel,
  repeatWeeksMessage,
  seriesHeading,
  weeklyDates,
} from "@/lib/recurrence";

describe("parseRepeatWeeks", () => {
  it("reads nothing as a single booking", () => {
    expect(parseRepeatWeeks(undefined)).toBe(1);
    expect(parseRepeatWeeks(null)).toBe(1);
    expect(parseRepeatWeeks("")).toBe(1);
  });

  it("accepts a whole number from 1 to the cap, as a number or a string", () => {
    expect(parseRepeatWeeks(1)).toBe(1);
    expect(parseRepeatWeeks(4)).toBe(4);
    expect(parseRepeatWeeks("4")).toBe(4);
    expect(parseRepeatWeeks(MAX_REPEAT_WEEKS)).toBe(MAX_REPEAT_WEEKS);
  });

  it("refuses zero, negatives, fractions, over the cap and junk", () => {
    for (const bad of [0, -1, 2.5, "2.5", MAX_REPEAT_WEEKS + 1, "x", {}, []]) {
      expect(parseRepeatWeeks(bad)).toBeNull();
    }
  });

  it("names the range in its refusal", () => {
    expect(repeatWeeksMessage()).toBe(
      `Choose how many weeks to repeat for, from 1 to ${MAX_REPEAT_WEEKS}.`,
    );
  });

  it("caps a series at eight weeks", () => {
    expect(MAX_REPEAT_WEEKS).toBe(8);
  });
});

describe("weeklyDates", () => {
  it("lists the same weekday a week apart, the given date first", () => {
    expect(weeklyDates("2026-07-16", 3)).toEqual([
      "2026-07-16",
      "2026-07-23",
      "2026-07-30",
    ]);
  });

  it("crosses a month end and a year end", () => {
    expect(weeklyDates("2026-12-28", 2)).toEqual(["2026-12-28", "2027-01-04"]);
  });

  it("gives one date for one week, or anything less", () => {
    expect(weeklyDates("2026-07-16", 1)).toEqual(["2026-07-16"]);
    expect(weeklyDates("2026-07-16", 0)).toEqual(["2026-07-16"]);
  });
});

describe("the wording", () => {
  it("labels a repeat, or says once", () => {
    expect(repeatLabel(1)).toBe("just this once");
    expect(repeatLabel(4)).toBe("every week for 4 weeks");
  });

  it("heads a date list with the weekday and the count", () => {
    expect(seriesHeading(["2026-07-16", "2026-07-23"])).toBe(
      "every week on Thursday, 2 dates",
    );
  });

  it("asks a guest to sign in before repeating", () => {
    expect(REPEAT_SIGN_IN_MESSAGE).toBe(
      "Sign in with Google to set up a weekly repeat.",
    );
  });
});
