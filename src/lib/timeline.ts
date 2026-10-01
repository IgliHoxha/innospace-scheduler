// Pure timeline helpers in minutes since midnight; no I/O, so they test alone.

export interface DaySegment<T> {
  fromMin: number;
  toMin: number;
  reserved: T | null;
}

export function buildDaySegments<T extends { start: number; end: number }>(
  dayStartMin: number,
  dayEndMin: number,
  reserved: readonly T[],
): DaySegment<T>[] {
  const inWindow = reserved
    .filter((r) => r.end > dayStartMin && r.start < dayEndMin)
    .sort((a, b) => a.start - b.start);
  const segments: DaySegment<T>[] = [];
  let cursor = dayStartMin;
  for (const r of inWindow) {
    const from = Math.max(r.start, dayStartMin);
    const to = Math.min(r.end, dayEndMin);
    if (from > cursor) {
      segments.push({ fromMin: cursor, toMin: from, reserved: null });
    }
    if (to > cursor) {
      segments.push({
        fromMin: Math.max(cursor, from),
        toMin: to,
        reserved: r,
      });
      cursor = to;
    }
  }
  if (cursor < dayEndMin) {
    segments.push({ fromMin: cursor, toMin: dayEndMin, reserved: null });
  }
  return segments;
}

export function snapToStep(min: number, stepMin: number): number {
  return Math.round(min / stepMin) * stepMin;
}

/** An end for a start, clamped to its free stretch; null if it will not fit. */
export function suggestedEndMin(
  startMin: number,
  limitMin: number,
  minDurationMin: number,
  preferredMin: number,
): number | null {
  if (limitMin - startMin < minDurationMin) return null;
  return Math.min(limitMin, startMin + Math.max(minDurationMin, preferredMin));
}

export function dragRange(
  anchorMin: number,
  atMin: number,
  stretch: { from: number; to: number },
  stepMin: number,
  minDurationMin: number,
): { from: number; to: number } {
  const clamp = (m: number) => Math.min(stretch.to, Math.max(stretch.from, m));
  // Outward, not nearest: a press shy of the hour would else start on it.
  let from = clamp(Math.floor(Math.min(anchorMin, atMin) / stepMin) * stepMin);
  let to = clamp(Math.ceil(Math.max(anchorMin, atMin) / stepMin) * stepMin);

  const shortest = Math.min(
    Math.ceil(Math.max(stepMin, minDurationMin) / stepMin) * stepMin,
    stretch.to - stretch.from,
  );
  if (to - from < shortest) {
    if (atMin >= anchorMin) {
      to = Math.min(from + shortest, stretch.to);
      from = to - shortest;
    } else {
      from = Math.max(to - shortest, stretch.from);
      to = from + shortest;
    }
  }
  return { from, to };
}

/** Hour marks thinned evenly to fit the bar, always keeping the last. */
export function tickMinutes(
  dayStartMin: number,
  dayEndMin: number,
  barPx: number,
  labelPx: number,
): number[] {
  const all: number[] = [];
  for (let m = Math.ceil(dayStartMin / 60) * 60; m <= dayEndMin; m += 60) {
    all.push(m);
  }
  const hours = (dayEndMin - dayStartMin) / 60;
  // Negated comparisons, so a NaN measurement leaves here too.
  if (all.length < 3 || !(barPx > 0) || !(hours > 0) || !(labelPx > 0))
    return all;
  const fit = (labelPx * hours) / barPx;
  // Infinity over infinity is NaN, so an unmeasurable pair keeps every mark.
  if (Number.isNaN(fit)) return all;
  let step = Math.max(1, Math.ceil(fit));
  // A stride dividing the span keeps the marks even and lands on the last.
  if (Number.isInteger(hours)) {
    step = Math.min(step, hours);
    // Bounded by the span itself, so no measurement can keep it turning.
    while (step < hours && hours % step !== 0) step++;
  }
  if (step === 1) return all;
  const kept = all.filter((_, i) => i % step === 0);
  const last = all[all.length - 1];
  if (kept[kept.length - 1] !== last) {
    // The last mark earns its place, so one too close to it gives way.
    if (kept.length > 1 && last - kept[kept.length - 1] < step * 60) kept.pop();
    kept.push(last);
  }
  return kept;
}

/** The designed floor, or more once the measured width outgrows it. */
export function roomFor(
  measuredPx: number,
  floorPx: number,
  /** In its own widths: 1.5 for a mark beside an edge-anchored one. */
  widths: number,
  gapPx: number,
): number {
  if (!(measuredPx > 0) || !Number.isFinite(measuredPx)) return floorPx;
  return Math.max(floorPx, Math.ceil(measuredPx * widths) + gapPx);
}

/** Hour marks thinned to this text size, none drawn over another. */
export function fittingTicks(
  dayStartMin: number,
  dayEndMin: number,
  barPx: number,
  /** One label's measured width, 0 before first render. */
  labelPx: number,
  floorPx: number,
  gapPx: number,
): number[] {
  const marks = tickMinutes(
    dayStartMin,
    dayEndMin,
    barPx,
    roomFor(labelPx, floorPx, 1.5, gapPx),
  );
  // Nothing to judge a collision by until both are measured.
  if (!(barPx > 0) || !(labelPx > 0)) return marks;
  const span = dayEndMin - dayStartMin;
  // As drawn: the day's first and last marks hug the bar's ends, the rest centre.
  const box = (m: number) => {
    if (m <= dayStartMin) return [0, labelPx];
    if (m >= dayEndMin) return [barPx - labelPx, barPx];
    const at = ((m - dayStartMin) / span) * barPx;
    return [at - labelPx / 2, at + labelPx / 2];
  };
  // A hair of slack, so float rounding cannot fail a pair that exactly fits.
  const slack = 1e-6;
  const fits = (ms: number[]) =>
    ms.every((m, i) => {
      const [from, to] = box(m);
      if (from < -slack || to > barPx + slack) return false;
      return i === 0 || from - box(ms[i - 1])[1] >= gapPx - slack;
    });
  let kept = marks;
  // Thinning stops at the two ends, so past that the last mark gives way.
  while (kept.length && !fits(kept)) kept = kept.slice(0, -1);
  return kept;
}

/** Where the pick's tag sits: inside a roomy pick, else a chip above it. */
export function pickTagPlacement(opts: {
  barPx: number;
  /** 0 before first render, when percent centring stands in. */
  tagPx: number;
  fromPct: number;
  toPct: number;
  /** A pick narrower than this cannot hold the tag, so it floats above. */
  fitsPx: number;
}): { above: boolean; centerPct: number; leftPx: number | null } {
  const { barPx, tagPx, fromPct, toPct, fitsPx } = opts;
  const centerPct = (fromPct + toPct) / 2;
  const above = barPx > 0 && (barPx * (toPct - fromPct)) / 100 < fitsPx;
  // No clamp until both widths are known.
  if (!above || tagPx <= 0) return { above, centerPct, leftPx: null };
  // Wider than the bar, it starts at the bar's left so the start time shows.
  if (tagPx >= barPx) return { above, centerPct, leftPx: 0 };
  const wanted = (barPx * centerPct) / 100 - tagPx / 2;
  // Only the overhang gives way, so the tag stays over its pick until the end.
  return {
    above,
    centerPct,
    leftPx: Math.max(0, Math.min(wanted, barPx - tagPx)),
  };
}

export function barPercent(
  min: number,
  dayStartMin: number,
  dayEndMin: number,
): number {
  const span = Math.max(1, dayEndMin - dayStartMin);
  return Math.max(0, Math.min(100, ((min - dayStartMin) / span) * 100));
}

/** A range ending on the last step is drawn to the bar's end. */
export function barEndPercent(
  min: number,
  dayStartMin: number,
  dayEndMin: number,
  lastEndMin: number,
): number {
  if (min >= lastEndMin) return 100;
  return barPercent(min, dayStartMin, dayEndMin);
}

export interface HourCell {
  from: number;
  to: number;
  /** Where a click here ends: the last box stops a step short of midnight. */
  end: number;
  /** Wholly free, not past, and long enough to book. */
  free: boolean;
}

export function hourCells<T>(
  segments: readonly DaySegment<T>[],
  earliestMin: number,
  dayStartMin: number,
  dayEndMin: number,
  lastEndMin: number,
  minDurationMin: number,
): HourCell[] {
  const cells: HourCell[] = [];
  for (let m = dayStartMin; m < dayEndMin; m += 60) {
    const to = Math.min(m + 60, dayEndMin);
    const end = Math.min(to, lastEndMin);
    cells.push({
      from: m,
      to,
      end,
      free:
        m >= earliestMin &&
        // A box cut short of its hour must still hold the shortest booking.
        end - m >= Math.min(minDurationMin, to - m) &&
        !segments.some((s) => s.reserved && s.fromMin < to && s.toMin > m),
    });
  }
  return cells;
}

export function findFreeGaps(
  reserved: readonly { start: number; end: number }[],
  earliestMin: number,
  dayEndMin: number,
  minDurationMin: number,
): { from: number; to: number }[] {
  const busy = [...reserved].sort((a, b) => a.start - b.start);
  let cursor = earliestMin;
  const gaps: { from: number; to: number }[] = [];
  for (const b of busy) {
    if (b.start > cursor) {
      gaps.push({ from: cursor, to: Math.min(b.start, dayEndMin) });
    }
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < dayEndMin) gaps.push({ from: cursor, to: dayEndMin });
  return gaps.filter((g) => g.to - g.from >= minDurationMin);
}

export function isDayOver(
  earliestMin: number,
  dayEndMin: number,
  minDurationMin: number,
): boolean {
  return dayEndMin - earliestMin < minDurationMin;
}

/** A day underway opens on its next free time, else at the preferred one. */
export function wantedStartMin(
  earliestMin: number,
  preferredMin: number,
): number {
  return earliestMin > 0 ? earliestMin : preferredMin;
}

/** The first stretch with room from `wantedMin`, else the first of all. */
export function seedGap(
  gaps: readonly { from: number; to: number }[],
  wantedMin: number,
  minDurationMin: number,
): { from: number; to: number } | null {
  for (const g of gaps) {
    const from = Math.max(g.from, wantedMin);
    if (g.to - from >= minDurationMin) return { from, to: g.to };
  }
  return gaps[0] ?? null;
}

/** Null when the start landed in no free stretch. */
export function endForStart(
  startMin: number,
  gaps: readonly { from: number; to: number }[],
  minDurationMin: number,
  preferredMin: number,
): number | null {
  const gap = gaps.find((g) => startMin >= g.from && startMin < g.to);
  if (!gap) return null;
  return suggestedEndMin(startMin, gap.to, minDurationMin, preferredMin);
}
