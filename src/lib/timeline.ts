// Pure timeline helpers in minutes since midnight; no I/O, so they test alone.

export interface DaySegment<T> {
  fromMin: number;
  toMin: number;
  /** The reservation occupying this segment, or null when the segment is free. */
  reserved: T | null;
}

/** Split the open day into reserved and free segments, clamped to the window. */
export function buildDaySegments<T extends { start: number; end: number }>(
  opensMin: number,
  closesMin: number,
  reserved: readonly T[],
): DaySegment<T>[] {
  const inWindow = reserved
    .filter((r) => r.end > opensMin && r.start < closesMin)
    .sort((a, b) => a.start - b.start);
  const segments: DaySegment<T>[] = [];
  let cursor = opensMin;
  for (const r of inWindow) {
    const from = Math.max(r.start, opensMin);
    const to = Math.min(r.end, closesMin);
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
  if (cursor < closesMin) {
    segments.push({ fromMin: cursor, toMin: closesMin, reserved: null });
  }
  return segments;
}

/** Round a minute value to the nearest step (snap a click to the time grid). */
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

/** What a drag covers, snapped outward onto the grid, inside its free stretch. */
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

/** The hour marks fitting this bar, thinned evenly, always keeping closing time. */
export function tickMinutes(
  opensMin: number,
  closesMin: number,
  barPx: number,
  labelPx: number,
): number[] {
  const all: number[] = [];
  for (let m = Math.ceil(opensMin / 60) * 60; m <= closesMin; m += 60) {
    all.push(m);
  }
  const hours = (closesMin - opensMin) / 60;
  // Nothing to thin before the bar is measured; two marks are the ends.
  if (all.length < 3 || barPx <= 0 || hours <= 0) return all;
  const step = Math.max(1, Math.ceil((labelPx * hours) / barPx));
  if (step === 1) return all;
  const kept = all.filter((_, i) => i % step === 0);
  const last = all[all.length - 1];
  if (kept[kept.length - 1] !== last) {
    // Closing time earns its place, so a mark too close to it gives way.
    if (kept.length > 1 && last - kept[kept.length - 1] < step * 60) kept.pop();
    kept.push(last);
  }
  return kept;
}

/** Where the pick's tag sits: inside a roomy pick, else a chip above it. */
export function pickTagPlacement(opts: {
  barPx: number;
  /** The tag's width, 0 before first render, when percent centring stands in. */
  tagPx: number;
  fromPct: number;
  toPct: number;
  /** A pick narrower than this cannot hold the tag, so it floats above. */
  fitsPx: number;
}): { above: boolean; centerPct: number; leftPx: number | null } {
  const { barPx, tagPx, fromPct, toPct, fitsPx } = opts;
  const centerPct = (fromPct + toPct) / 2;
  const above = barPx > 0 && (barPx * (toPct - fromPct)) / 100 < fitsPx;
  // Nothing to clamp until both widths are known, and an oversized tag never fits.
  if (!above || tagPx <= 0 || tagPx >= barPx)
    return { above, centerPct, leftPx: null };
  const wanted = (barPx * centerPct) / 100 - tagPx / 2;
  // Only the overhang gives way, so the tag stays over its pick until the end.
  return {
    above,
    centerPct,
    leftPx: Math.max(0, Math.min(wanted, barPx - tagPx)),
  };
}

/** The end for a moved start, clamped to its stretch; null if it landed in none. */
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
