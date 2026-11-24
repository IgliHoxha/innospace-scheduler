// The edge's s-maxage plus stale-while-revalidate, in total.
export const EDGE_STALE_MS = 60_000;

// In localStorage, so a cancel on /bookings or /cancel still busts the board "/" loads next.
const WROTE_KEY = "innospace.wroteAt";

/** Records that this browser just changed a booking, for every page and tab of it. */
export function noteBoardWrite(now: number = Date.now()): void {
  try {
    localStorage.setItem(WROTE_KEY, String(now));
  } catch {
    // Private mode: the board may show the edge's copy for up to a minute.
  }
}

/** When this browser last changed a booking, 0 when unknown. */
export function lastBoardWrite(): number {
  try {
    const at = Number(localStorage.getItem(WROTE_KEY));
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

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
