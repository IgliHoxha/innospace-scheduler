/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for a small Docker image.
  output: "standalone",
  // Don't bundle the native sqlite module - keep it external so its .node binary loads.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
