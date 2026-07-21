import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminToken, makeRequest, resetApp, userToken } from "../helpers/app";

vi.mock("@/lib/email", () => ({
  sendReservationEmail: vi.fn().mockResolvedValue(undefined),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

type Route = typeof import("@/app/api/reservations/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
let route: Route;
let db: Db;
let email: Email;

const DAY = "2026-07-16";
const member = () => userToken("u1", "Ada", "ada@example.com");

type Body = {
  ok: boolean;
  error?: string;
  reservation?: { status: string };
  total?: number;
  removed?: number;
};
const json = (res: Response) => res.json() as Promise<Body>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T12:00:00`)); // noon: 09:00 is past, 14:00 future
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/reservations/route");
  email = await import("@/lib/email");
});

afterEach(() => vi.useRealTimers());

const ok = { boothId: "booth-1", date: DAY, start: "14:00", end: "15:00" };
const post = (body: unknown, tok = member()) =>
  route.POST(
    makeRequest("/api/reservations", { method: "POST", body, token: tok }),
  );

describe("POST /api/reservations - validation", () => {
  it("401 without a session", async () => {
    const res = await route.POST(
      makeRequest("/api/reservations", { method: "POST", body: ok }),
    );
    expect(res.status).toBe(401);
  });
  it("400 for an unknown booth", async () => {
    expect((await post({ ...ok, boothId: "nope" })).status).toBe(400);
  });
  it("400 for a date outside the window", async () => {
    expect((await post({ ...ok, date: "1999-01-01" })).status).toBe(400);
  });
  it("400 for an off-grid time", async () => {
    expect((await post({ ...ok, start: "14:07" })).status).toBe(400);
  });
  it("400 when the end is not after the start", async () => {
    expect((await post({ ...ok, end: "14:00" })).status).toBe(400);
  });
  it("400 when shorter than the minimum reservation", async () => {
    expect((await post({ ...ok, end: "14:10" })).status).toBe(400);
  });
  it("400 for a time that has already passed", async () => {
    const res = await post({ ...ok, start: "09:00", end: "10:00" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("already passed");
  });
  it("400 when a note is required (>= 2h) but missing", async () => {
    const res = await post({ ...ok, end: "16:00" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("note");
  });
  it("400 for an over-long note", async () => {
    expect((await post({ ...ok, note: "x".repeat(501) })).status).toBe(400);
  });
  it("400 on a malformed JSON body (parse falls back to empty)", async () => {
    const res = await route.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        rawBody: "{ not json",
        token: member(),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/reservations - success", () => {
  it("201 confirmed for a short reservation, and emails the member", async () => {
    const res = await post(ok);
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("confirmed");
    expect(email.sendReservationEmail).toHaveBeenCalledOnce();
  });
  it("201 pending for a long reservation that needs approval", async () => {
    const res = await post({ ...ok, end: "17:00", note: "Workshop" }); // 3h
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("pending");
    expect(vi.mocked(email.sendReservationEmail).mock.calls[0][1]).toBe(
      "pending",
    );
  });
  it("409 when the slot overlaps an existing active reservation", async () => {
    await post(ok);
    expect((await post({ ...ok, start: "14:30", end: "15:30" })).status).toBe(
      409,
    );
  });
});

describe("GET /api/reservations", () => {
  it("401 without a session", async () => {
    expect((await route.GET(makeRequest("/api/reservations"))).status).toBe(
      401,
    );
  });
  it("scopes a member to their own rows while an admin sees all", async () => {
    await db.createReservation({
      boothId: "booth-1",
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T15:00`,
      userId: "u1",
    });
    await db.createReservation({
      boothId: "booth-2",
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T15:00`,
      userId: "u2",
    });
    const mine = await json(
      await route.GET(
        makeRequest("/api/reservations?status=all", { token: member() }),
      ),
    );
    expect(mine.total).toBe(1);
    const all = await json(
      await route.GET(
        makeRequest("/api/reservations?status=all", { token: adminToken() }),
      ),
    );
    expect(all.total).toBe(2);
  });
});

describe("DELETE /api/reservations", () => {
  const del = (body: unknown, tok: string) =>
    route.DELETE(
      makeRequest("/api/reservations", { method: "DELETE", body, token: tok }),
    );
  it("401 for a non-admin", async () => {
    expect((await del({ ids: ["x"] }, member())).status).toBe(401);
  });
  it("400 for a malformed ids payload", async () => {
    expect((await del({ ids: "x" }, adminToken())).status).toBe(400);
  });
  it("400 on a malformed JSON body (parse falls back to empty)", async () => {
    const res = await route.DELETE(
      makeRequest("/api/reservations", {
        method: "DELETE",
        rawBody: "{ not json",
        token: adminToken(),
      }),
    );
    expect(res.status).toBe(400);
  });
  it("hard-deletes only soft-deleted rows", async () => {
    const r = await db.createReservation({
      boothId: "booth-1",
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T15:00`,
      userId: "u1",
    });
    await db.updateReservationStatus(r.id, "deleted");
    const res = await del({ ids: [r.id] }, adminToken());
    expect(res.status).toBe(200);
    expect((await json(res)).removed).toBe(1);
  });
});
