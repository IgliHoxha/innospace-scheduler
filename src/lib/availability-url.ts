// The board's query string and booth tallies, kept out of the component to be tested.

// The edge's s-maxage plus stale-while-revalidate, in total.
export const EDGE_STALE_MS = 60_000;

/** True while the edge could hold a board older than our last write. */
export function edgeMayBeStale(now: number, wroteAt: number): boolean {
  return now - wroteAt < EDGE_STALE_MS;
}

export function countsForDate(
  board: { date?: string; counts?: Record<string, number> } | null,
  date: string,
): Record<string, number> | undefined {
  return board?.date === date ? board.counts : undefined;
}

export function reservationCountLabel(count: number): string {
  const n = Math.max(0, count);
  return n === 1 ? "1 reservation" : `${n} reservations`;
}

export function availabilityQuery(
  boothId: string,
  date: string,
  freshAt?: number,
): string {
  const params = new URLSearchParams({ booth: boothId, date });
  // Cloudflare caches 30s and ignores no-store, so only a new URL misses.
  if (freshAt !== undefined) params.set("t", String(freshAt));
  return params.toString();
}
