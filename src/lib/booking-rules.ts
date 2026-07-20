// Pure booking-rule predicates. Config is injected (not read from env) so the
// same definitions back both sides that must agree:
//   - the server, via schedule.ts (env-configured), and
//   - the client booking form, which receives the config as props.
// Keeping the rule math here means the two can't drift apart.
//
// All durations are in minutes; times of day are minutes-since-midnight.

/** Is the booking at least the minimum length? */
export function meetsMinDuration(
  durationMin: number,
  minBookingMin: number,
): boolean {
  return durationMin >= minBookingMin;
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

/** Over the auto-approve threshold, the booking needs admin approval. */
export function approvalRequiredFor(
  durationMin: number,
  autoApproveMaxHours: number,
): boolean {
  return durationMin > autoApproveMaxHours * 60;
}

/**
 * The first booked range that overlaps [startMin, endMin), or null. Half-open,
 * so touching edges (10:00–11:00 and 11:00–12:00) don't clash. Generic over the
 * booked item so callers keep whatever extra fields (label, etc.) they carry.
 */
export function findOverlap<T extends { start: number; end: number }>(
  startMin: number,
  endMin: number,
  booked: readonly T[],
): T | null {
  return booked.find((b) => b.start < endMin && b.end > startMin) ?? null;
}
