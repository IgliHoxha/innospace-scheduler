// Pure predicates with config injected, so server and form cannot drift. Minutes.

/** The latest a booking may end: the day's last grid step, as "24:00" is not a time. */
export function dayEndMinute(stepMin: number): number {
  return 24 * 60 - stepMin;
}

/** A time of day on the step grid, any hour; the form checks it first. */
export function isBookableMinute(minutes: number, stepMin: number): boolean {
  if (!Number.isInteger(minutes)) return false;
  if (minutes < 0 || minutes > dayEndMinute(stepMin)) return false;
  return minutes % stepMin === 0;
}

/** Is the reservation at least the minimum length? */
export function meetsMinDuration(
  durationMin: number,
  minReservationMin: number,
): boolean {
  return durationMin >= minReservationMin;
}

/** `>=` the threshold needs a note, `>` also needs approval. */
export function noteRequiredFor(
  durationMin: number,
  autoApproveMaxHours: number,
): boolean {
  return durationMin >= autoApproveMaxHours * 60;
}

/** Over the auto-approve threshold, the reservation needs admin approval. */
export function approvalRequiredFor(
  durationMin: number,
  autoApproveMaxHours: number,
): boolean {
  return durationMin > autoApproveMaxHours * 60;
}

/** Booked minutes of the run this joins, so a split stay cannot dodge the limits. */
export function runTotalMinutes(
  startMin: number,
  endMin: number,
  held: readonly { start: number; end: number }[],
  maxGapMin = 0,
): number {
  let runStart = startMin;
  let runEnd = endMin;
  let total = Math.max(0, endMin - startMin);

  // Nearest first, so a reachable far one cannot swallow the booking filling the gap.
  const taken = new Set<number>();
  for (;;) {
    let best = -1;
    let bestGap = Infinity;
    held.forEach((h, i) => {
      if (taken.has(i) || h.end <= h.start) return;
      // Beside the run, never across: an overlap is a clash, and would count twice.
      if (h.end > runStart && h.start < runEnd) return;
      const gap = h.start >= runEnd ? h.start - runEnd : runStart - h.end;
      if (gap > maxGapMin || gap >= bestGap) return;
      best = i;
      bestGap = gap;
    });
    if (best < 0) return total;
    const h = held[best];
    taken.add(best);
    total += h.end - h.start;
    runStart = Math.min(runStart, h.start);
    runEnd = Math.max(runEnd, h.end);
  }
}

/** First range overlapping [startMin, endMin), or null; edges never clash. */
export function findOverlap<T extends { start: number; end: number }>(
  startMin: number,
  endMin: number,
  reserved: readonly T[],
): T | null {
  return reserved.find((b) => b.start < endMin && b.end > startMin) ?? null;
}
