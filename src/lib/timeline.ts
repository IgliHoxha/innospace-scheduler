// Pure helpers for the day-timeline availability view (member reservation screen).
// Minutes are minutes-since-midnight; no I/O, no env, so they unit-test in isolation.

export interface DaySegment<T> {
  fromMin: number;
  toMin: number;
  /** The reservation occupying this segment, or null when the segment is free. */
  reserved: T | null;
}

/**
 * Split the open day [opensMin, closesMin) into consecutive reserved and free
 * segments. Reservations are clamped to the window, and dropped if fully outside.
 */
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

/**
 * A sensible end for a start picked inside a free stretch: the preferred length,
 * clamped to the stretch. Null when even the minimum won't fit before its limit.
 */
export function suggestedEndMin(
  startMin: number,
  limitMin: number,
  minDurationMin: number,
  preferredMin: number,
): number | null {
  if (limitMin - startMin < minDurationMin) return null;
  return Math.min(limitMin, startMin + Math.max(minDurationMin, preferredMin));
}

/**
 * The end to pair with a start that just moved, clamped to whichever free stretch
 * the start landed in. Null when it landed in none of them, so the caller can
 * leave the end untouched and let validation do the talking.
 */
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
