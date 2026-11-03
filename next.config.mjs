/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Kept external so the native .node binary loads from node_modules.
  serverExternalPackages: ["better-sqlite3"],
  // Every image is a plain <img>, so the optimizer and its native sharp stay out of the image.
  images: { unoptimized: true },
  outputFileTracingExcludes: {
    "*": ["node_modules/@img/**", "node_modules/sharp/**"],
  },

  // Edge caching stops crawlers waking the Fly machine; browsers revalidate.
  async headers() {
    const noStore = [{ key: "Cache-Control", value: "no-store" }];
    return [
      {
        // Edge-cached for everyone, so it must never render anything from the session.
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
      // Session-specific, and "/" is cached, so this is where the form asks.
      { source: "/api/me", headers: noStore },
      { source: "/api/auth/:path*", headers: noStore },
      { source: "/api/cancel", headers: noStore },
      { source: "/api/reservations/:path*", headers: noStore },
    ];
  },
};

export default nextConfig;
