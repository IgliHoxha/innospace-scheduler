import { describe, expect, it } from "vitest";
import {
  barEndPercent,
  barPercent,
  buildDaySegments,
  dragRange,
  endForStart,
  findFreeGaps,
  fittingTicks,
  hourCells,
  isDayOver,
  pickTagPlacement,
  roomFor,
  seedGap,
  snapToStep,
  suggestedEndMin,
  tickMinutes,
  wantedStartMin,
} from "@/lib/timeline";

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

describe("endForStart", () => {
  // 09:00-12:00 free, 12:00-14:00 taken, 14:00-15:00 free.
  const gaps = [
    { from: 540, to: 720 },
    { from: 840, to: 900 },
  ];

  it("puts the end an hour after the start", () => {
    expect(endForStart(600, gaps, 15, 60)).toBe(660); // 10:00 -> 11:00
  });

  it("clamps to the end of the stretch the start landed in", () => {
    // 14:30 in the 14:00-15:00 gap: a full hour would overrun, so stop at 15:00.
    expect(endForStart(870, gaps, 15, 60)).toBe(900);
  });

  it("picks the stretch containing the start, not the first one", () => {
    expect(endForStart(845, gaps, 15, 60)).toBe(900);
  });

  it("returns null for a start inside a reservation", () => {
    expect(endForStart(780, gaps, 15, 60)).toBeNull(); // 13:00 is taken
  });

  it("returns null for a start on a stretch's exclusive end", () => {
    // Ranges are half-open, so 12:00 belongs to the reservation, not the gap.
    expect(endForStart(720, gaps, 15, 60)).toBeNull();
  });

  it("returns null when the remaining stretch is shorter than the minimum", () => {
    expect(endForStart(895, gaps, 15, 60)).toBeNull(); // only 5 min left
  });
});

describe("seedGap", () => {
  const MORNING = 9 * 60;
  const wholeDay = [{ from: 0, to: 1435 }];

  it("opens an empty day at the wanted time, not at midnight", () => {
    expect(seedGap(wholeDay, MORNING, 15)).toEqual({ from: MORNING, to: 1435 });
  });

  it("opens on the stretch's own start when that is already later", () => {
    // Today at 13:10: the free stretch starts after the wanted time.
    expect(seedGap([{ from: 790, to: 1435 }], MORNING, 15)).toEqual({
      from: 790,
      to: 1435,
    });
  });

  it("skips to the next stretch when the wanted time is taken", () => {
    // 09:00-11:00 booked: free until 09:00, then from 11:00.
    const gaps = [
      { from: 0, to: 540 },
      { from: 660, to: 1435 },
    ];
    expect(seedGap(gaps, MORNING, 15)).toEqual({ from: 660, to: 1435 });
  });

  it("starts mid-stretch when the wanted time falls inside one", () => {
    const gaps = [
      { from: 0, to: 600 },
      { from: 720, to: 1435 },
    ];
    expect(seedGap(gaps, MORNING, 15)).toEqual({ from: MORNING, to: 600 });
  });

  it("passes over a stretch with less than the minimum left after the wanted time", () => {
    // 09:00 to 09:10 is free but too short, so the seed moves on to 11:00.
    const gaps = [
      { from: 0, to: 550 },
      { from: 660, to: 1435 },
    ];
    expect(seedGap(gaps, MORNING, 15)).toEqual({ from: 660, to: 1435 });
  });

  it("takes a stretch with exactly the minimum left", () => {
    const gaps = [{ from: 0, to: 555 }];
    expect(seedGap(gaps, MORNING, 15)).toEqual({ from: MORNING, to: 555 });
  });

  // Booked solid from 09:00: only the early morning is left, so open there.
  it("falls back to the day's first stretch when nothing later has room", () => {
    const gaps = [{ from: 0, to: 540 }];
    expect(seedGap(gaps, MORNING, 15)).toEqual({ from: 0, to: 540 });
  });

  it("falls back to the first of several early stretches, not the last", () => {
    const gaps = [
      { from: 0, to: 180 },
      { from: 240, to: 540 },
    ];
    expect(seedGap(gaps, MORNING, 15)).toEqual({ from: 0, to: 180 });
  });

  it("returns null when there is no free stretch at all", () => {
    expect(seedGap([], MORNING, 15)).toBeNull();
  });
});

describe("dragRange", () => {
  // 09:00-17:00 free, the shape a drag is confined to.
  const stretch = { from: 540, to: 1020 };

  it("snaps both ends to the step, not to the hour", () => {
    // 14:02 -> 14:00, 15:38 -> 15:40 on a 5 minute grid.
    expect(dragRange(842, 938, stretch, 5, 15)).toEqual({ from: 840, to: 940 });
  });

  it("reads the same dragged backwards", () => {
    expect(dragRange(938, 842, stretch, 5, 15)).toEqual({ from: 840, to: 940 });
  });

  it("grows forwards to the shortest bookable length", () => {
    // A 5 minute drag would be refused by the form, so it opens at 15.
    expect(dragRange(600, 605, stretch, 5, 15)).toEqual({ from: 600, to: 615 });
  });

  it("grows backwards when the drag went left", () => {
    expect(dragRange(600, 595, stretch, 5, 15)).toEqual({ from: 585, to: 600 });
  });

  it("never leaves the free stretch, however far the pointer goes", () => {
    expect(dragRange(1000, 1400, stretch, 5, 15)).toEqual({
      from: 1000,
      to: 1020,
    });
    expect(dragRange(560, 100, stretch, 5, 15)).toEqual({
      from: 540,
      to: 560,
    });
  });

  it("backs off the far end rather than overrun it to reach the minimum", () => {
    // 5 minutes short of closing: the range has to extend backwards instead.
    expect(dragRange(1015, 1020, stretch, 5, 15)).toEqual({
      from: 1005,
      to: 1020,
    });
  });

  it("gives the whole stretch when even the minimum will not fit", () => {
    const tiny = { from: 600, to: 610 };
    expect(dragRange(600, 605, tiny, 5, 15)).toEqual({ from: 600, to: 610 });
  });

  it("rounds a minimum that does not sit on the grid up onto it", () => {
    expect(dragRange(600, 600, stretch, 5, 12)).toEqual({ from: 600, to: 615 });
  });

  it("keeps a whole-hour drag exactly an hour", () => {
    expect(dragRange(600, 660, stretch, 5, 15)).toEqual({ from: 600, to: 660 });
  });

  // Pressing at 09:58 once rounded to 10:00, born on the hour line.
  it("does not let a press just shy of the hour snap forward onto it", () => {
    expect(dragRange(598, 602, stretch, 5, 15)).toEqual({ from: 595, to: 610 });
  });

  it("snaps outward, so the range covers everything dragged over", () => {
    // 10:01 -> 11:29 must not shrink to 10:00 -> 11:30's inside.
    expect(dragRange(601, 689, stretch, 5, 15)).toEqual({ from: 600, to: 690 });
  });

  it("grows leftward for a leftward drag, still without rounding inward", () => {
    // 10:02 ceils to 10:05, the minimum made up going back, as the pointer moved.
    expect(dragRange(602, 598, stretch, 5, 15)).toEqual({ from: 590, to: 605 });
  });
});

describe("a reservation starting before the window opens", () => {
  it("is clamped to opening time with no free sliver in front of it", () => {
    // 08:00-10:00 against a 09:00 open: the segment starts at 09:00.
    const segs = buildDaySegments(540, 1380, [{ start: 480, end: 600 }]);
    expect(segs[0]).toMatchObject({ fromMin: 540, toMin: 600 });
    expect(segs[0].reserved).not.toBeNull();
  });

  it("drops a reservation that ends before the window even opens", () => {
    const segs = buildDaySegments(540, 1380, [{ start: 400, end: 480 }]);
    expect(segs).toEqual([{ fromMin: 540, toMin: 1380, reserved: null }]);
  });
});

describe("pickTagPlacement", () => {
  // A 1000px bar over a 09:00-23:00 day, and a tag the size the chip renders at.
  const BAR = 1000;
  const TAG = 90;
  const FITS = 96;
  const place = (
    fromPct: number,
    toPct: number,
    over: Partial<{ barPx: number; tagPx: number }> = {},
  ) =>
    pickTagPlacement({
      barPx: BAR,
      tagPx: TAG,
      fromPct,
      toPct,
      fitsPx: FITS,
      ...over,
    });

  it("keeps a roomy pick's tag inside it, centred", () => {
    const p = place(0, 20);
    expect(p.above).toBe(false);
    expect(p.centerPct).toBe(10);
    expect(p.leftPx).toBeNull();
  });

  it("floats the tag above a pick too narrow to hold it", () => {
    expect(place(0, 9).above).toBe(true);
    // Exactly the fitting width still counts as roomy.
    expect(place(0, 9.6).above).toBe(false);
  });

  // The bug: a narrow pick near the end pinned its tag to the bar's edge.
  it("centres a floating tag on its pick rather than on the bar's end", () => {
    const p = place(85.71, 92.86);
    expect(p.leftPx).toBeCloseTo(847.85, 1);
    expect(p.leftPx! + TAG / 2).toBeCloseTo((BAR * p.centerPct) / 100, 1);
  });

  it("gives up only the overhang when the pick sits against an end", () => {
    expect(place(0, 7.14).leftPx).toBe(0);
    expect(place(92.86, 100).leftPx).toBe(BAR - TAG);
  });

  it("falls back to percent centring until both widths are known", () => {
    expect(place(40, 47, { barPx: 0 })).toMatchObject({
      above: false,
      leftPx: null,
    });
    expect(place(40, 47, { tagPx: 0 })).toMatchObject({
      above: true,
      leftPx: null,
    });
  });

  it("does not try to clamp a tag wider than the bar", () => {
    expect(place(40, 47, { tagPx: BAR + 1 }).leftPx).toBeNull();
  });
});

describe("tickMinutes", () => {
  // The 24-hour day the booking screen draws, 00:00 to 24:00.
  const START = 0;
  const END = 1440;
  const LABEL = 48;
  const at = (barPx: number) => tickMinutes(START, END, barPx, LABEL);
  const hours = (mins: number[]) => mins.map((m) => m / 60);

  it("labels every hour when the bar is wide enough", () => {
    expect(at(1200)).toHaveLength(25);
    expect(hours(at(1200)).slice(0, 3)).toEqual([0, 1, 2]);
  });

  it("labels every other hour on the desktop bar", () => {
    expect(hours(at(1126))).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24,
    ]);
  });

  it("thins the labels on a phone-width bar", () => {
    expect(hours(at(301))).toEqual([0, 4, 8, 12, 16, 20, 24]);
  });

  // 5 hours would fit here, but 5 does not divide 24 and would leave the evening bare.
  it("rounds the stride up to one that divides the day, so marks stay even", () => {
    expect(hours(at(286))).toEqual([0, 6, 12, 18, 24]);
    expect(hours(at(246))).toEqual([0, 6, 12, 18, 24]);
    expect(hours(at(150))).toEqual([0, 8, 16, 24]);
    expect(hours(at(100))).toEqual([0, 12, 24]);
  });

  // A width that is not a number must not spin the divisor loop.
  it("gives every mark for an unmeasurable bar", () => {
    expect(at(Number.NaN)).toHaveLength(25);
    expect(at(-10)).toHaveLength(25);
    expect(tickMinutes(0, 1440, 300, Number.NaN)).toHaveLength(25);
  });

  it("settles on an answer for extreme measurements", () => {
    expect(at(Number.POSITIVE_INFINITY)).toHaveLength(25);
    expect(at(Number.MIN_VALUE)).toEqual([START, END]);
    expect(at(1e-9)).toEqual([START, END]);
    expect(tickMinutes(0, 1440, 300, Number.POSITIVE_INFINITY)).toEqual([
      START,
      END,
    ]);
    expect(tickMinutes(0, 1440, 300, Number.MAX_VALUE)).toEqual([START, END]);
  });

  // Infinity over infinity is NaN, which no stride comparison ever settles.
  it("keeps every mark when the bar and the label are both unmeasurable", () => {
    const inf = Number.POSITIVE_INFINITY;
    expect(tickMinutes(0, 1440, inf, inf)).toHaveLength(25);
    expect(tickMinutes(0, 1440, inf, Number.MAX_VALUE)).toHaveLength(25);
    expect(tickMinutes(0, 1440, inf, 1e308)).toHaveLength(25);
    expect(tickMinutes(0, 1439, inf, inf)).toEqual(
      Array.from({ length: 24 }, (_, h) => h * 60),
    );
  });

  it("returns for every whole pixel width a screen could give it", () => {
    for (let barPx = 1; barPx <= 2600; barPx++) {
      const marks = at(barPx);
      expect(marks[0]).toBe(START);
      expect(marks[marks.length - 1]).toBe(END);
      expect(24 % (marks.length - 1)).toBe(0);
    }
  });

  it("never goes below the two ends, however narrow", () => {
    expect(at(60)).toEqual([START, END]);
    expect(at(1)).toEqual([START, END]);
  });

  it("keeps both ends, evenly spaced, with room for each label, at any width", () => {
    for (const barPx of [
      1200, 1126, 768, 375, 301, 286, 246, 150, 100, 60, 1,
    ]) {
      const marks = at(barPx);
      expect(marks[0]).toBe(START);
      expect(marks[marks.length - 1]).toBe(END);
      const gaps = marks.slice(1).map((m, i) => m - marks[i]);
      expect(new Set(gaps).size).toBe(1);
      // Whatever survives has to have room for its own label.
      const gapPx = (gaps[0] / (END - START)) * barPx;
      if (marks.length > 2) expect(gapPx).toBeGreaterThanOrEqual(LABEL);
    }
  });

  it("labels every hour until the bar has been measured", () => {
    expect(at(0)).toHaveLength(25);
  });

  it("uses a divisor for any whole-hour span, not only 24", () => {
    // 14 hours at a stride of 3 would be uneven, so it steps up to 7.
    expect(hours(tickMinutes(540, 1380, 220, 44))).toEqual([9, 16, 23]);
    expect(hours(tickMinutes(540, 1380, 350, 44))).toEqual([
      9, 11, 13, 15, 17, 19, 21, 23,
    ]);
  });

  it("starts on the first whole hour of a span that begins mid-hour", () => {
    expect(hours(tickMinutes(570, 720, 1000, 44))).toEqual([10, 11, 12]);
  });

  // No stride divides a part-hour span, so the last mark is kept by dropping its neighbour.
  it("keeps the last mark of a part-hour span, dropping the one that would crowd it", () => {
    expect(hours(tickMinutes(570, 1380, 220, 44))).toEqual([
      10, 13, 16, 19, 23,
    ]);
  });

  it("keeps both ends of a bar with room for nothing else", () => {
    expect(hours(tickMinutes(540, 660, 40, 44))).toEqual([9, 11]);
  });
});

describe("barPercent", () => {
  const at = (min: number) => barPercent(min, 0, 1440);

  it("places a minute by its share of the 24-hour bar", () => {
    expect(at(0)).toBe(0);
    expect(at(720)).toBe(50);
    expect(at(360)).toBe(25);
    expect(at(1440)).toBe(100);
  });

  // Hour lines, boxes and ticks all read this, so the grid must stay even.
  it("keeps every hour evenly spaced, including the last", () => {
    for (let h = 0; h <= 24; h++)
      expect(at(h * 60)).toBeCloseTo(h * (100 / 24), 9);
  });

  it("clamps a minute outside the bar", () => {
    expect(at(-30)).toBe(0);
    expect(at(1500)).toBe(100);
  });

  it("reads a window that is not a whole day", () => {
    expect(barPercent(600, 540, 660)).toBe(50);
  });

  // A zero-width day would divide by zero; it clamps instead of returning NaN.
  it("does not divide by a zero-width day", () => {
    expect(barPercent(5, 600, 600)).toBe(0);
    expect(barPercent(605, 600, 600)).toBe(100);
  });
});

describe("barEndPercent", () => {
  const at = (min: number) => barEndPercent(min, 0, 1440, 1435);

  // A booking cannot end later, so its edge belongs on the bar's rounded end.
  it("draws an end on the last bookable minute at the very end of the bar", () => {
    expect(at(1435)).toBe(100);
    expect(at(1440)).toBe(100);
  });

  it("leaves the minute before it where it falls", () => {
    expect(at(1430)).toBeLessThan(100);
    expect(at(1430)).toBeCloseTo((1430 / 1440) * 100, 5);
  });

  it("agrees with barPercent everywhere else", () => {
    for (const m of [0, 60, 720, 1380, 1425]) {
      expect(at(m)).toBe(barPercent(m, 0, 1440));
    }
  });

  // With hourly steps the last step is an hour mark, which must not snap.
  it("snaps only the end edge, so an hourly step keeps its 23:00 mark", () => {
    expect(barEndPercent(1380, 0, 1440, 1380)).toBe(100);
    expect(barPercent(1380, 0, 1440)).toBeCloseTo(95.8333, 3);
  });
});

describe("hourCells", () => {
  const LAST = 1435; // 23:55, the last step on a 5-minute grid
  const cells = (
    reserved: { start: number; end: number }[],
    earliest = 0,
    lastEnd = LAST,
    minDuration = 15,
  ) =>
    hourCells(
      buildDaySegments(0, 1440, reserved),
      earliest,
      0,
      1440,
      lastEnd,
      minDuration,
    );

  it("gives an empty day 24 free boxes, one per hour", () => {
    const all = cells([]);
    expect(all).toHaveLength(24);
    expect(all.every((c) => c.free)).toBe(true);
    expect(all[0]).toEqual({ from: 0, to: 60, end: 60, free: true });
    expect(all[9]).toEqual({ from: 540, to: 600, end: 600, free: true });
  });

  // The box still spans its hour on the bar, but a click stops at 23:55.
  it("ends the last box's pick a step short of midnight", () => {
    expect(cells([])[23]).toEqual({
      from: 1380,
      to: 1440,
      end: 1435,
      free: true,
    });
  });

  it("closes every box that has already started", () => {
    const all = cells([], 13 * 60 + 10);
    expect(all[12].free).toBe(false);
    expect(all[13].free).toBe(false); // 13:00 began ten minutes ago
    expect(all[14].free).toBe(true);
  });

  it("opens the box that starts exactly now", () => {
    expect(cells([], 14 * 60)[14].free).toBe(true);
  });

  it("closes a box that is booked, wholly or in part", () => {
    const all = cells([
      { start: 600, end: 660 },
      { start: 14 * 60 + 30, end: 14 * 60 + 45 },
    ]);
    expect(all[10].free).toBe(false);
    expect(all[14].free).toBe(false);
    expect(all[9].free).toBe(true);
    expect(all[11].free).toBe(true);
    expect(all[15].free).toBe(true);
  });

  it("leaves a box free when a booking only touches its edge", () => {
    const all = cells([{ start: 600, end: 660 }]);
    expect(all[9].free).toBe(true);
    expect(all[11].free).toBe(true);
  });

  // 23:00 - 23:30 is all the last box can offer here, short of the 60-minute minimum.
  it("closes the last box when what is left of it is under the minimum", () => {
    const all = cells([], 0, 1410, 60);
    expect(all[23]).toMatchObject({ end: 1410, free: false });
    expect(all[22].free).toBe(true);
  });

  it("closes the last box when an hourly step leaves it nothing", () => {
    const all = cells([], 0, 1380, 15);
    expect(all[23]).toMatchObject({ end: 1380, free: false });
    expect(all[22]).toMatchObject({ end: 1380, free: true });
  });

  it("keeps every ordinary box open when the minimum runs past an hour", () => {
    const long = cells([], 0, LAST, 90);
    expect(long.slice(0, 23).every((c) => c.free)).toBe(true);
    expect(long[23].free).toBe(false);
    expect(cells([], 0, LAST, 180)[9].free).toBe(true);
  });

  it("keeps the last box open when the minimum just fits", () => {
    expect(cells([], 0, LAST, 55)[23].free).toBe(true);
    expect(cells([], 0, LAST, 56)[23].free).toBe(false);
  });
});

describe("findFreeGaps", () => {
  const END = 1435;

  it("gives an empty day one stretch, midnight to the last step", () => {
    expect(findFreeGaps([], 0, END, 15)).toEqual([{ from: 0, to: END }]);
  });

  it("starts at the earliest reservable minute, not at midnight", () => {
    expect(findFreeGaps([], 790, END, 15)).toEqual([{ from: 790, to: END }]);
  });

  it("splits around bookings, whatever order they arrive in", () => {
    const reserved = [
      { start: 840, end: 900 },
      { start: 540, end: 600 },
    ];
    expect(findFreeGaps(reserved, 0, END, 15)).toEqual([
      { from: 0, to: 540 },
      { from: 600, to: 840 },
      { from: 900, to: END },
    ]);
  });

  it("drops a stretch too short to hold a booking", () => {
    const reserved = [
      { start: 540, end: 600 },
      { start: 610, end: 660 },
    ];
    expect(findFreeGaps(reserved, 0, END, 15)).toEqual([
      { from: 0, to: 540 },
      { from: 660, to: END },
    ]);
  });

  it("keeps a stretch of exactly the minimum", () => {
    const reserved = [
      { start: 540, end: 600 },
      { start: 615, end: 660 },
    ];
    expect(findFreeGaps(reserved, 0, END, 15)).toContainEqual({
      from: 600,
      to: 615,
    });
  });

  it("leaves no gap between bookings that touch", () => {
    const reserved = [
      { start: 540, end: 600 },
      { start: 600, end: 660 },
    ];
    expect(findFreeGaps(reserved, 0, END, 15)).toEqual([
      { from: 0, to: 540 },
      { from: 660, to: END },
    ]);
  });

  // The ordinary state of today's board once a booking has finished.
  it("does not reopen a booking that ended before the earliest minute", () => {
    expect(findFreeGaps([{ start: 540, end: 600 }], 840, END, 15)).toEqual([
      { from: 840, to: END },
    ]);
  });

  it("starts after a booking already underway", () => {
    expect(findFreeGaps([{ start: 540, end: 600 }], 570, END, 15)).toEqual([
      { from: 600, to: END },
    ]);
  });

  it("stops at the last step, so no stretch offers an end at 24:00", () => {
    const gaps = findFreeGaps([{ start: 0, end: 1380 }], 0, END, 15);
    expect(gaps).toEqual([{ from: 1380, to: END }]);
  });

  it("is empty when a booking runs to the end of the day", () => {
    expect(findFreeGaps([{ start: 0, end: END }], 0, END, 15)).toEqual([]);
  });

  it("is empty once the earliest minute is past the last step", () => {
    expect(findFreeGaps([], 1440, END, 15)).toEqual([]);
    expect(findFreeGaps([], 1425, END, 15)).toEqual([]);
  });

  it("does not reorder the caller's list", () => {
    const reserved = [
      { start: 840, end: 900 },
      { start: 540, end: 600 },
    ];
    findFreeGaps(reserved, 0, END, 15);
    expect(reserved[0].start).toBe(840);
  });
});

describe("isDayOver", () => {
  const END = 1435;

  it("is false while a whole booking still fits", () => {
    expect(isDayOver(0, END, 15)).toBe(false);
    expect(isDayOver(1420, END, 15)).toBe(false); // exactly the minimum left
  });

  it("is true once less than the minimum remains", () => {
    expect(isDayOver(1425, END, 15)).toBe(true);
    expect(isDayOver(END, END, 15)).toBe(true);
  });

  // The route rounds 23:56 up to "24:00", which is past the last step.
  it("is true for an earliest minute past the end of the day", () => {
    expect(isDayOver(1440, END, 15)).toBe(true);
  });
});

describe("wantedStartMin", () => {
  const MORNING = 9 * 60;

  it("prefers mid-morning on a day nothing has passed on", () => {
    expect(wantedStartMin(0, MORNING)).toBe(MORNING);
  });

  it("uses the next free time on a day already underway", () => {
    expect(wantedStartMin(1, MORNING)).toBe(1);
    expect(wantedStartMin(5, MORNING)).toBe(5);
    expect(wantedStartMin(6 * 60, MORNING)).toBe(6 * 60);
    expect(wantedStartMin(13 * 60 + 10, MORNING)).toBe(13 * 60 + 10);
  });
});

describe("roomFor", () => {
  // The booking screen's own figures: a 27px hour mark and a 71px tag at their designed sizes.
  const tick = (px: number) => roomFor(px, 48, 1.5, 7);
  const tag = (px: number) => roomFor(px, 96, 1, 24);

  it("keeps the designed figure at the designed text size", () => {
    expect(tick(27)).toBe(48);
    expect(tag(71)).toBe(96);
  });

  it("keeps the designed figure for text smaller than designed", () => {
    expect(tick(20)).toBe(48);
    expect(tag(40)).toBe(96);
  });

  it("grows once the measured text outgrows the design", () => {
    expect(tick(28)).toBe(49);
    expect(tick(108)).toBe(169);
    expect(tag(73)).toBe(97);
    expect(tag(258)).toBe(282);
  });

  it("rounds a fractional width up, never short", () => {
    expect(roomFor(33, 10, 1.5, 0)).toBe(50);
    expect(roomFor(100.2, 10, 1, 0)).toBe(101);
  });

  it("falls back to the designed figure before anything is measured", () => {
    expect(tick(0)).toBe(48);
    expect(tick(-5)).toBe(48);
    expect(tick(Number.NaN)).toBe(48);
    expect(tick(Number.POSITIVE_INFINITY)).toBe(48);
  });
});

describe("fittingTicks", () => {
  const START = 0;
  const END = 1440;
  const FLOOR = 48;
  const GAP = 7;
  const fit = (barPx: number, labelPx: number) =>
    fittingTicks(START, END, barPx, labelPx, FLOOR, GAP);

  /** Where each label lies on the bar: the ends anchored to its edges, the rest centred. */
  const spans = (marks: number[], barPx: number, labelPx: number) =>
    marks.map((m) => {
      if (m <= START) return [0, labelPx];
      if (m >= END) return [barPx - labelPx, barPx];
      const at = (m / END) * barPx;
      return [at - labelPx / 2, at + labelPx / 2];
    });

  it("thins exactly as before while the label is unmeasured", () => {
    for (let barPx = 0; barPx <= 2600; barPx += 7) {
      expect(fit(barPx, 0)).toEqual(tickMinutes(START, END, barPx, FLOOR));
    }
  });

  it("thins exactly as before at the designed text size", () => {
    for (let barPx = 61; barPx <= 2600; barPx++) {
      expect(fit(barPx, 27)).toEqual(tickMinutes(START, END, barPx, FLOOR));
    }
  });

  it("labels fewer marks as the text grows", () => {
    const hours = (px: number) => fit(1126, px).map((m) => m / 60);
    expect(hours(27)).toHaveLength(13);
    expect(hours(65)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24]);
    expect(hours(108)).toEqual([0, 4, 8, 12, 16, 20, 24]);
    expect(hours(173)).toEqual([0, 6, 12, 18, 24]);
    expect(hours(400)).toEqual([0, 24]);
  });

  // The whole point: whatever the text measures, no label is drawn over its neighbour.
  it("never lets two labels touch, at any bar width and any label width", () => {
    for (let labelPx = 8; labelPx <= 420; labelPx += 3) {
      for (let barPx = 40; barPx <= 2600; barPx += 11) {
        const at = spans(fit(barPx, labelPx), barPx, labelPx);
        for (let i = 1; i < at.length; i++) {
          expect(at[i][0] - at[i - 1][1]).toBeGreaterThanOrEqual(GAP);
        }
        for (const [from, to] of at) {
          expect(from).toBeGreaterThanOrEqual(0);
          expect(to).toBeLessThanOrEqual(barPx);
        }
      }
    }
  });

  it("keeps both ends while the two of them still fit", () => {
    expect(fit(207, 100)).toEqual([START, END]);
    expect(fit(300, 100)).toEqual([START, END]);
  });

  it("keeps the start alone when the two ends would touch", () => {
    expect(fit(206, 100)).toEqual([START]);
    expect(fit(100, 100)).toEqual([START]);
  });

  it("labels nothing when one label is wider than the bar", () => {
    expect(fit(99, 100)).toEqual([]);
    expect(fit(300, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("returns every mark before the bar is measured, whatever the label", () => {
    expect(fit(0, 27)).toHaveLength(25);
    expect(fit(0, 400)).toHaveLength(25);
    expect(fit(Number.NaN, 400)).toHaveLength(25);
    expect(fit(1126, Number.NaN)).toEqual(tickMinutes(START, END, 1126, FLOOR));
  });

  it("always starts on the day's first mark when it labels anything", () => {
    for (const labelPx of [27, 60, 150, 300]) {
      for (let barPx = 50; barPx <= 2000; barPx += 13) {
        const marks = fit(barPx, labelPx);
        if (marks.length) expect(marks[0]).toBe(START);
        if (marks.length > 1) expect(marks[marks.length - 1]).toBe(END);
      }
    }
  });
});
