// Pure reservation-rule predicates. Config is injected (not read from env) so the
// same math backs both the server (schedule.ts) and the client form (via props),
// so they can't drift. Durations in minutes; times of day minutes-since-midnight.

/** Is the reservation at least the minimum length? */
export function meetsMinDuration(
  durationMin: number,
  minReservationMin: number,
): boolean {
  return durationMin >= minReservationMin;
}

/**
 * At or over the auto-approve threshold, a note is required (so the admin has
 * context). Note the boundary: `>=` needs a note, `>` also needs approval.
 */
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

/**
 * The first reserved range that overlaps [startMin, endMin), or null. Half-open,
 * so touching edges (10:00-11:00 and 11:00-12:00) don't clash. Generic over the
 * reserved item so callers keep whatever extra fields (label, etc.) they carry.
 */
export function findOverlap<T extends { start: number; end: number }>(
  startMin: number,
  endMin: number,
  reserved: readonly T[],
): T | null {
  return reserved.find((b) => b.start < endMin && b.end > startMin) ?? null;
}
