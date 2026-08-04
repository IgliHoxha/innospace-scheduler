// The booking board's query string, kept out of the component so the cache-busting rule can be tested.

/** Query for /api/availability; pass `freshAt` (a timestamp) when the board must not come from the CDN. */
export function availabilityQuery(
  boothId: string,
  date: string,
  freshAt?: number,
): string {
  const params = new URLSearchParams({ booth: boothId, date });
  // Cloudflare caches this for 30s and ignores a request's no-store, so only a new URL guarantees a miss.
  if (freshAt !== undefined) params.set("t", String(freshAt));
  return params.toString();
}
