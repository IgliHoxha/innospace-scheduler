// The board's query string, kept out of the component so it can be tested.

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
