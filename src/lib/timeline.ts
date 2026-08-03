// Pure day-timeline helpers in minutes-since-midnight; no I/O or env, so they test alone.

export interface DaySegment<T> {
  fromMin: number;
  toMin: number;
  /** The reservation occupying this segment, or null when the segment is free. */
  reserved: T | null;
}

/** Split the open day into consecutive reserved and free segments, clamped to the window. */
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

/** A sensible end for a start, clamped to its free stretch; null when the minimum won't fit. */
export function suggestedEndMin(
  startMin: number,
  limitMin: number,
  minDurationMin: number,
  preferredMin: number,
): number | null {
  if (limitMin - startMin < minDurationMin) return null;
  return Math.min(limitMin, startMin + Math.max(minDurationMin, preferredMin));
}

/** The range a drag covers, snapped outward onto the step grid and kept inside its free stretch. */
export function dragRange(
  anchorMin: number,
  atMin: number,
  stretch: { from: number; to: number },
  stepMin: number,
  minDurationMin: number,
): { from: number; to: number } {
  const clamp = (m: number) => Math.min(stretch.to, Math.max(stretch.from, m));
  // Outward, not nearest: a press just shy of the hour would otherwise start the range on it.
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

/** The end for a start that just moved, clamped to its free stretch; null when it landed in none. */
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
