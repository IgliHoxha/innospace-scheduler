/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for a small Docker image.
  output: "standalone",
  // Keep better-sqlite3 external so its native .node binary loads from
  // node_modules rather than being bundled.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
