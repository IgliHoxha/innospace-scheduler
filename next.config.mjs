/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for a small Docker image.
  output: "standalone",
  // Kept external so the native .node binary loads from node_modules.
  serverExternalPackages: ["better-sqlite3"],

  // Edge caching stops crawlers waking the Fly machine; browsers revalidate.
  async headers() {
    const noStore = [{ key: "Cache-Control", value: "no-store" }];
    return [
      {
        // The shell varies only with the date list, which rolls once a day.
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
        // Cacheable only because a booking or cancel busts it with a `t` param.
        source: "/api/availability",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=30, stale-while-revalidate=30",
          },
        ],
      },
      // Explicit, so a broad Cloudflare cache rule can't leak an admin page.
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
