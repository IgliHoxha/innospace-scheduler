/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for a small Docker image.
  output: "standalone",
  // Keep better-sqlite3 external so its native .node binary loads from
  // node_modules rather than being bundled.
  serverExternalPackages: ["better-sqlite3"],

  // Cache-Control for the Cloudflare edge, so crawler traffic stops waking the
  // Fly machine. `s-maxage` is what the CDN honours; `max-age=0` keeps browsers
  // revalidating, so a booking screen is never served from a visitor's own disk.
  async headers() {
    const noStore = [{ key: "Cache-Control", value: "no-store" }];
    return [
      {
        // The booking shell varies only with the reservable-date list, which
        // rolls once a day, so minutes of edge TTL are safe.
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
          },
        ],
      },
      {
        // Cacheable only because a booking or cancellation refetches with a `t` param to force a miss.
        source: "/api/availability",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=30, stale-while-revalidate=30",
          },
        ],
      },
      // Never cacheable, stated explicitly so a broad "cache everything" rule at
      // Cloudflare can't ever serve one admin's dashboard to somebody else.
      { source: "/dashboard/:path*", headers: noStore },
      { source: "/login", headers: noStore },
      { source: "/cancel/:path*", headers: noStore },
      { source: "/api/login", headers: noStore },
      { source: "/api/cancel", headers: noStore },
      { source: "/api/reservations/:path*", headers: noStore },
    ];
  },
};

export default nextConfig;
