import { describe, expect, it } from "vitest";
import { buildDaySegments, snapToStep, suggestedEndMin } from "@/lib/timeline";

// Reserved ranges as minutes-since-midnight (09:00 = 540, etc.).
const r = (start: number, end: number, who = "") => ({ start, end, who });

describe("buildDaySegments", () => {
  it("returns one free segment for an empty day", () => {
    expect(buildDaySegments(540, 1140, [])).toEqual([
      { fromMin: 540, toMin: 1140, reserved: null },
    ]);
  });

  it("interleaves free and reserved segments in order", () => {
    const segs = buildDaySegments(540, 1140, [r(600, 660, "Ada")]);
    expect(segs).toEqual([
      { fromMin: 540, toMin: 600, reserved: null },
      { fromMin: 600, toMin: 660, reserved: r(600, 660, "Ada") },
      { fromMin: 660, toMin: 1140, reserved: null },
    ]);
  });

  it("sorts unordered reservations and has no free gap between touching ones", () => {
    const segs = buildDaySegments(540, 1140, [r(660, 720), r(600, 660)]);
    expect(segs.map((s) => [s.fromMin, s.toMin, !!s.reserved])).toEqual([
      [540, 600, false],
      [600, 660, true],
      [660, 720, true],
      [720, 1140, false],
    ]);
  });

  it("drops a reservation at the very start with no leading free segment", () => {
    const segs = buildDaySegments(540, 1140, [r(540, 600)]);
    expect(segs[0]).toEqual({
      fromMin: 540,
      toMin: 600,
      reserved: r(540, 600),
    });
  });

  it("clamps a reservation that overruns the open window", () => {
    const segs = buildDaySegments(540, 1140, [r(1080, 1260)]);
    expect(segs).toEqual([
      { fromMin: 540, toMin: 1080, reserved: null },
      { fromMin: 1080, toMin: 1140, reserved: r(1080, 1260) },
    ]);
  });

  it("ignores reservations entirely outside the open window", () => {
    expect(buildDaySegments(540, 1140, [r(0, 540), r(1140, 1200)])).toEqual([
      { fromMin: 540, toMin: 1140, reserved: null },
    ]);
  });
});

describe("snapToStep", () => {
  it("rounds to the nearest step", () => {
    expect(snapToStep(612, 30)).toBe(600); // 10:12 -> 10:00
    expect(snapToStep(628, 30)).toBe(630); // 10:28 -> 10:30
    expect(snapToStep(615, 30)).toBe(630); // exact midpoint rounds up
  });
});

describe("suggestedEndMin", () => {
  it("adds the preferred length, clamped to the limit", () => {
    expect(suggestedEndMin(600, 1140, 30, 60)).toBe(660); // +60 fits
    expect(suggestedEndMin(600, 630, 30, 60)).toBe(630); // clamped to limit
  });

  it("never returns shorter than the minimum", () => {
    // limit only 30 min away, minimum 30 -> exactly the limit
    expect(suggestedEndMin(600, 630, 30, 15)).toBe(630);
  });

  it("returns null when even the minimum does not fit", () => {
    expect(suggestedEndMin(600, 620, 30, 60)).toBeNull();
  });
});
