// Pure rule predicates with config injected, so server and client form can't drift. Minutes throughout.

/** Inside opening hours and on the step grid: the form checks it before the route repeats it. */
export function isBookableMinute(
  minutes: number,
  openMin: number,
  closeMin: number,
  stepMin: number,
): boolean {
  if (!Number.isInteger(minutes)) return false;
  if (minutes < openMin || minutes > closeMin) return false;
  return minutes % stepMin === 0;
}

/** Is the reservation at least the minimum length? */
export function meetsMinDuration(
  durationMin: number,
  minReservationMin: number,
): boolean {
  return durationMin >= minReservationMin;
}

/** At or over the threshold a note is required: `>=` needs a note, `>` also needs approval. */
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

/** Booked minutes of the back-to-back run this booking joins, so a split stay can't dodge the limits. */
export function runTotalMinutes(
  startMin: number,
  endMin: number,
  held: readonly { start: number; end: number }[],
  maxGapMin = 0,
): number {
  let runStart = startMin;
  let runEnd = endMin;
  let total = Math.max(0, endMin - startMin);

  // Each pass can extend the run and bring another booking in reach, so sweep until none joins.
  const taken = new Set<number>();
  for (let grew = true; grew;) {
    grew = false;
    held.forEach((h, i) => {
      if (taken.has(i) || h.end <= h.start) return;
      if (h.start > runEnd + maxGapMin || h.end < runStart - maxGapMin) return;
      // Beside the run, never across it: an overlap is a clash, and would count twice.
      if (h.end > runStart && h.start < runEnd) return;
      taken.add(i);
      total += h.end - h.start;
      runStart = Math.min(runStart, h.start);
      runEnd = Math.max(runEnd, h.end);
      grew = true;
    });
  }
  return total;
}

/** First reserved range overlapping [startMin, endMin), or null; half-open so touching edges are fine. */
export function findOverlap<T extends { start: number; end: number }>(
  startMin: number,
  endMin: number,
  reserved: readonly T[],
): T | null {
  return reserved.find((b) => b.start < endMin && b.end > startMin) ?? null;
}
