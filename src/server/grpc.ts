// gRPC server skeleton for the SchedulerService (see proto/scheduler.proto).
//
// It's a standalone process, not part of the Next.js app, so it uses relative
// imports (no "@/..." alias resolution needed at runtime) and reads the .proto
// from the working directory. Feature it on by running `npm run grpc`; it isn't
// started by the web server. The handlers are read-only and reuse the same db
// layer the app uses.
import path from "path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { getBooths } from "../lib/booths";
import { bookedRanges, getReservation } from "../lib/db";

const PROTO_PATH = path.join(process.cwd(), "proto", "scheduler.proto");

// Message shapes mirror scheduler.proto (keepCase: true → snake_case fields).
type Empty = Record<string, never>;
interface BoothMsg {
  id: string;
  name: string;
  capacity: number;
}
interface BoothList {
  booths: BoothMsg[];
}
interface AvailabilityRequest {
  booth_id: string;
  date: string;
}
interface BookedRangeMsg {
  starts_at: string;
  ends_at: string;
  booked_by: string;
}
interface AvailabilityResponse {
  booth_id: string;
  date: string;
  booked: BookedRangeMsg[];
}
interface GetReservationRequest {
  id: string;
}
interface ReservationMsg {
  id: string;
  status: string;
  booth_id: string;
  starts_at: string;
  ends_at: string;
  full_name: string;
}
interface ReservationResponse {
  found: boolean;
  reservation?: ReservationMsg;
}

/** Load the service definition out of the .proto at startup. */
function loadService(): grpc.ServiceDefinition {
  const pkgDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(pkgDef) as unknown as {
    scheduler: { SchedulerService: grpc.ServiceClientConstructor };
  };
  return pkg.scheduler.SchedulerService.service;
}

function listBooths(
  _call: grpc.ServerUnaryCall<Empty, BoothList>,
  callback: grpc.sendUnaryData<BoothList>,
): void {
  const booths = getBooths().map((b) => ({
    id: b.id,
    name: b.name,
    capacity: b.capacity ?? 0,
  }));
  callback(null, { booths });
}

async function getAvailability(
  call: grpc.ServerUnaryCall<AvailabilityRequest, AvailabilityResponse>,
  callback: grpc.sendUnaryData<AvailabilityResponse>,
): Promise<void> {
  const { booth_id, date } = call.request;
  try {
    const booked = (await bookedRanges(booth_id, date)).map((r) => ({
      starts_at: r.startsAt,
      ends_at: r.endsAt,
      booked_by: r.bookedBy ?? "",
    }));
    callback(null, { booth_id, date, booked });
  } catch (err) {
    callback({ code: grpc.status.INTERNAL, message: String(err) }, null);
  }
}

async function getReservationRpc(
  call: grpc.ServerUnaryCall<GetReservationRequest, ReservationResponse>,
  callback: grpc.sendUnaryData<ReservationResponse>,
): Promise<void> {
  try {
    const r = await getReservation(call.request.id);
    if (!r) {
      callback(null, { found: false });
      return;
    }
    callback(null, {
      found: true,
      reservation: {
        id: r.id,
        status: r.status,
        booth_id: r.boothId ?? "",
        starts_at: r.startsAt ?? "",
        ends_at: r.endsAt ?? "",
        full_name: r.fullName ?? "",
      },
    });
  } catch (err) {
    callback({ code: grpc.status.INTERNAL, message: String(err) }, null);
  }
}

/** Build a gRPC server with the SchedulerService wired to the db layer. */
export function createGrpcServer(): grpc.Server {
  const server = new grpc.Server();
  // Handlers are typed per-RPC above; addService wants the untyped shape.
  server.addService(loadService(), {
    ListBooths: listBooths,
    GetAvailability: getAvailability,
    GetReservation: getReservationRpc,
  } as unknown as grpc.UntypedServiceImplementation);
  return server;
}
