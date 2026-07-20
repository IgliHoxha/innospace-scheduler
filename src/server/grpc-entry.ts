// Standalone entrypoint for the gRPC server: `npm run grpc`.
// Runs independently of the Next.js web app (own process, own port).
import * as grpc from "@grpc/grpc-js";
import { createGrpcServer } from "./grpc";

const host = process.env.GRPC_HOST || "0.0.0.0";
const port = Number(process.env.GRPC_PORT || "50051");

const server = createGrpcServer();

server.bindAsync(
  `${host}:${port}`,
  grpc.ServerCredentials.createInsecure(),
  (err, boundPort) => {
    if (err) {
      console.error("[grpc] failed to bind:", err);
      process.exit(1);
    }
    console.log(`[grpc] SchedulerService listening on ${host}:${boundPort}`);
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.tryShutdown((err) => {
      if (err) console.error("[grpc] shutdown error:", err);
      process.exit(0);
    });
  });
}
