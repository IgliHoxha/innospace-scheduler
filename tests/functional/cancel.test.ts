import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { createCancelToken, createSessionToken } from "@/lib/auth";
import { epochMsOf } from "@/lib/datetime";

type Route = typeof import("@/app/api/cancel/route");
type Db = typeof import("@/lib/db");
let route: Route;
let db: Db;

const DAY = "2026-07-16";
const ENDS_AT = `${DAY}T15:00`;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T12:00:00`));
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/cancel/route");
});

const seed = (status: "confirmed" | "pending" = "confirmed") =>
  db.createReservation(
    {
      boothId: "booth-1",
      startsAt: `${DAY}T14:00`,
      endsAt: ENDS_AT,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
    },
    status,
  );

const post = (token?: unknown) =>
  route.POST(makeRequest("/api/cancel", { method: "POST", body: { token } }));

const json = (res: Response) =>
  res.json() as Promise<{
    ok: boolean;
    error?: string;
    alreadyCancelled?: boolean;
  }>;

describe("POST /api/cancel", () => {
  it("cancels the reservation the token names", async () => {
    const r = await seed();
    const res = await post(createCancelToken(r.id, epochMsOf(ENDS_AT)));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, alreadyCancelled: false });
    expect((await db.getReservation(r.id))?.status).toBe("cancelled");
  });

  it("cancels a pending request too", async () => {
    const r = await seed("pending");
    await post(createCancelToken(r.id, epochMsOf(ENDS_AT)));
    expect((await db.getReservation(r.id))?.status).toBe("cancelled");
  });

  it("400 with no token", async () => {
    expect((await post(undefined)).status).toBe(400);
  });

  it("400 for a garbage token", async () => {
    expect((await post("not-a-token")).status).toBe(400);
  });

  it("400 for a tampered payload (the signature no longer matches)", async () => {
    const r = await seed();
    const good = createCancelToken(r.id, epochMsOf(ENDS_AT));
    const [, sig] = good.split(".");
    const forged = `${Buffer.from(
      JSON.stringify({
        sub: "other-id",
        purpose: "cancel",
        exp: Date.now() + 1000,
      }),
      "utf8",
    ).toString("base64url")}.${sig}`;
    expect((await post(forged)).status).toBe(400);
  });

  it("400 once the reservation's end time has passed", async () => {
    const r = await seed();
    const token = createCancelToken(r.id, epochMsOf(ENDS_AT));
    vi.setSystemTime(new Date(`${DAY}T15:01:00`));
    expect((await post(token)).status).toBe(400);
    expect((await db.getReservation(r.id))?.status).toBe("confirmed");
  });

  it("rejects a session cookie replayed as a cancel token (purpose-scoped)", async () => {
    const r = await seed();
    const session = createSessionToken({
      role: "admin",
      sub: r.id,
      name: "admin",
    });
    expect((await post(session)).status).toBe(400);
    expect((await db.getReservation(r.id))?.status).toBe("confirmed");
  });

  it("404 when the reservation is gone", async () => {
    expect(
      (await post(createCancelToken("ghost", Date.now() + 60_000))).status,
    ).toBe(404);
  });

  it("reports success on a second click rather than an error", async () => {
    const r = await seed();
    const token = createCancelToken(r.id, epochMsOf(ENDS_AT));
    await post(token);
    const res = await post(token);
    expect(res.status).toBe(200);
    expect((await json(res)).alreadyCancelled).toBe(true);
  });

  it("400 on a malformed JSON body (parse falls back to empty)", async () => {
    const res = await route.POST(
      makeRequest("/api/cancel", { method: "POST", rawBody: "{ not json" }),
    );
    expect(res.status).toBe(400);
  });
});
