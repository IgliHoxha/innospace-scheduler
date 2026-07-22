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
 * segments from the booth's (non-overlapping) reservations. Ranges are clamped to
 * the open window and anything fully outside it is dropped.
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
 * A sensible end when the member picks a start inside a free stretch: the start
 * plus a preferred length, never past the stretch's limit and never shorter than
 * the minimum. Returns null when even the minimum can't fit before the limit.
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
