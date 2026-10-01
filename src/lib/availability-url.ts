// The board's query string, kept out of the component so it can be tested.

// The edge's s-maxage plus stale-while-revalidate: how long it can serve an older board.
export const EDGE_STALE_MS = 60_000;

/** Whether the edge could still hold a board older than this browser's last write. */
export function edgeMayBeStale(now: number, wroteAt: number): boolean {
  return now - wroteAt < EDGE_STALE_MS;
}

/** A board's per-booth counts, but only when it answers for the day on screen. */
export function countsForDate(
  board: { date?: string; counts?: Record<string, number> } | null,
  date: string,
): Record<string, number> | undefined {
  return board?.date === date ? board.counts : undefined;
}

/** Query for /api/availability; `freshAt` keeps the board off the CDN. */
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
