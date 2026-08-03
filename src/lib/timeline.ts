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
 * The range a drag covers: from where it started to where the pointer is now,
 * snapped outward onto the step grid and never leaving the free stretch it began
 * in. Grows away from the anchor to the shortest bookable length, so a drag can't
 * hand the form a range it would only reject, and stops at the stretch's end when
 * that is all there is.
 */
export function dragRange(
  anchorMin: number,
  atMin: number,
  stretch: { from: number; to: number },
  stepMin: number,
  minDurationMin: number,
): { from: number; to: number } {
  const clamp = (m: number) => Math.min(stretch.to, Math.max(stretch.from, m));
  // Outward, not to the nearest mark: a press 2 minutes shy of the hour would
  // otherwise round forward onto it and the range would appear to start in the
  // next box. Expanding both ways keeps everything swept over inside the range.
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
