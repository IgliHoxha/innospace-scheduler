import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminToken, makeRequest, resetApp } from "../helpers/app";

vi.mock("@/lib/email", () => ({
  sendReservationEmail: vi.fn().mockResolvedValue(undefined),
}));

type Route = typeof import("@/app/api/reservations/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
let route: Route;
let db: Db;
let email: Email;

const DAY = "2026-07-16";

type Body = {
  ok: boolean;
  error?: string;
  field?: string;
  reservation?: { status: string; fullName?: string; email?: string };
  total?: number;
  counts?: { total: number };
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

const who = { fullName: "Ada Lovelace", email: "ada@example.com" };
const ok = {
  boothId: "booth-1",
  date: DAY,
  start: "14:00",
  end: "15:00",
  ...who,
};
// No token: booking is public. `ip` varies the client so the per-IP throttle
// (20 attempts) can't leak between tests in the same module registry.
const post = (body: unknown, ip = "test-ip") =>
  route.POST(
    makeRequest("/api/reservations", {
      method: "POST",
      body,
      headers: { "x-real-ip": ip },
    }),
  );

describe("POST /api/reservations - identity validation", () => {
  it("400 with the offending field when the name is missing", async () => {
    const res = await post({ ...ok, fullName: "  " });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.field).toBe("fullName");
    expect(body.error).toContain("full name");
  });
  it("400 when only one name is given", async () => {
    const res = await post({ ...ok, fullName: "Ada" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("first and last name");
  });
  it("400 when the email is missing", async () => {
    const res = await post({ ...ok, email: "" });
    expect(res.status).toBe(400);
    expect((await json(res)).field).toBe("email");
  });
  it("400 for a malformed email", async () => {
    const res = await post({ ...ok, email: "ada@nope" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("valid email");
  });
  it("400 for an over-long name", async () => {
    expect(
      (await post({ ...ok, fullName: `Ada ${"x".repeat(81)}` })).status,
    ).toBe(400);
  });
  it("400 for a non-string name (a JSON array can't smuggle past the cap)", async () => {
    expect((await post({ ...ok, fullName: ["Ada", "Lovelace"] })).status).toBe(
      400,
    );
  });
});

describe("POST /api/reservations - slot validation", () => {
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
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/reservations - success", () => {
  it("201 confirmed for a short reservation, stored under the booker's details", async () => {
    const res = await post(ok);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.reservation?.status).toBe("confirmed");
    expect(body.reservation?.fullName).toBe("Ada Lovelace");
    expect(body.reservation?.email).toBe("ada@example.com");
    expect(email.sendReservationEmail).toHaveBeenCalledOnce();
  });
  it("lower-cases the email so the same person is one identity", async () => {
    const res = await post({ ...ok, email: "ADA@Example.COM" });
    expect((await json(res)).reservation?.email).toBe("ada@example.com");
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
  it("409 when that email already holds an overlapping booth", async () => {
    await post(ok); // booth-1, 14:00-15:00
    const res = await post({ ...ok, boothId: "booth-2", start: "14:30" });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toContain("already have a reservation");
  });
  it("lets a different person take the same time in another booth", async () => {
    await post(ok);
    const res = await post({
      ...ok,
      boothId: "booth-2",
      fullName: "Grace Hopper",
      email: "grace@example.com",
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/reservations - per-IP throttle", () => {
  it("429 with Retry-After once the IP passes the attempt limit", async () => {
    const ip = "flooder";
    // Back-to-back quarter-hours from 09:00: adjacent ranges are half-open, so
    // none of them clash and only the throttle can reject one.
    const hhmm = (min: number) =>
      `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    // 20 accepted bookings = LOGIN_IP_MAX_ATTEMPTS in the test baseline.
    for (let i = 0; i < 20; i++) {
      const res = await post(
        {
          ...ok,
          date: "2026-07-17", // tomorrow: nothing on it has passed
          start: hhmm(9 * 60 + i * 15),
          end: hhmm(9 * 60 + i * 15 + 15),
          email: `flood${i}@example.com`,
        },
        ip,
      );
      expect(res.status).toBe(201); // the setup itself must not be the failure
    }
    const res = await post({ ...ok, start: "16:00", end: "16:30" }, ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
  it("does not throttle a different IP", async () => {
    expect((await post(ok, "someone-else")).status).toBe(201);
  });
});

describe("GET /api/reservations", () => {
  it("401 without an admin session", async () => {
    expect((await route.GET(makeRequest("/api/reservations"))).status).toBe(
      401,
    );
  });
  it("returns every reservation plus the stat counts for an admin", async () => {
    await db.createReservation({
      boothId: "booth-1",
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T15:00`,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
    });
    await db.createReservation({
      boothId: "booth-2",
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T15:00`,
      fullName: "Grace Hopper",
      email: "grace@example.com",
    });
    const all = await json(
      await route.GET(
        makeRequest("/api/reservations?status=all", { token: adminToken() }),
      ),
    );
    expect(all.total).toBe(2);
    expect(all.counts).toMatchObject({ total: 2 });
  });
});

describe("DELETE /api/reservations", () => {
  const del = (body: unknown, tok?: string) =>
    route.DELETE(
      makeRequest("/api/reservations", { method: "DELETE", body, token: tok }),
    );
  it("401 without an admin session", async () => {
    expect((await del({ ids: ["x"] })).status).toBe(401);
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
      email: "ada@example.com",
    });
    await db.updateReservationStatus(r.id, "deleted");
    const res = await del({ ids: [r.id] }, adminToken());
    expect(res.status).toBe(200);
    expect((await json(res)).removed).toBe(1);
  });
});

describe("POST /api/reservations - Turnstile", () => {
  // Never reaches Cloudflare: siteverify is stubbed per test.
  const fetchMock = vi.fn();
  const enable = () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
    vi.stubGlobal("fetch", fetchMock);
  };
  const siteverify = (success: boolean) =>
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success }) });

  beforeEach(() => fetchMock.mockReset());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is skipped entirely when the keys are unset", async () => {
    vi.stubGlobal("fetch", fetchMock);
    expect((await post(ok)).status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("403 and no reservation when the token is missing", async () => {
    enable();
    const res = await post(ok);
    expect(res.status).toBe(403);
    expect((await json(res)).error).toContain("verify");
    expect((await db.queryReservations({})).total).toBe(0);
    expect(email.sendReservationEmail).not.toHaveBeenCalled();
  });

  it("403 when Cloudflare rejects the token", async () => {
    enable();
    siteverify(false);
    const res = await post({ ...ok, turnstileToken: "bad" });
    expect(res.status).toBe(403);
    expect((await db.queryReservations({})).total).toBe(0);
  });

  // Fails closed: a Cloudflare outage must not become a way in.
  it("403 when siteverify itself errors", async () => {
    enable();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // A plain stub, not vi.fn(): a mock that rejects has its result tracked and
    // the rejection resurfaces as an unhandled error even once we catch it.
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNRESET")));
    expect((await post({ ...ok, turnstileToken: "tok" })).status).toBe(403);
    expect((await db.queryReservations({})).total).toBe(0);
    err.mockRestore();
  });

  it("201 when Cloudflare confirms the token", async () => {
    enable();
    siteverify(true);
    const res = await post({ ...ok, turnstileToken: "good" });
    expect(res.status).toBe(201);
    expect((await db.queryReservations({})).total).toBe(1);
  });

  // The token is single-use, so it must not be spent on a request that was
  // never going to succeed.
  it("does not call siteverify when the slot itself is invalid", async () => {
    enable();
    siteverify(true);
    expect(
      (await post({ ...ok, start: "14:07", turnstileToken: "good" })).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
