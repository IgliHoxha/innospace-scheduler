/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for a small Docker image.
  output: "standalone",
  // Keep native/server-only modules external so they load from node_modules
  // rather than being bundled (better-sqlite3's .node binary; the Kafka/gRPC
  // clients used by the events skeleton).
  serverExternalPackages: [
    "better-sqlite3",
    "kafkajs",
    "@grpc/grpc-js",
    "@grpc/proto-loader",
  ],
};

export default nextConfig;
