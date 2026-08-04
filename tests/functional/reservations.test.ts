import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminToken, makeRequest, resetApp } from "../helpers/app";

// DNS is stubbed: the suite must never do a real lookup.
vi.mock("@/lib/email-verify", () => ({
  checkEmailDeliverable: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/email", () => ({
  sendReservationEmail: vi.fn().mockResolvedValue("sent"),
}));

type Route = typeof import("@/app/api/reservations/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
type Verify = typeof import("@/lib/email-verify");
let route: Route;
let db: Db;
let email: Email;
let verify: Verify;

const DAY = "2026-07-16";

type Body = {
  ok: boolean;
  error?: string;
  field?: string;
  reservation?: {
    id?: string;
    status: string;
    fullName?: string;
    email?: string;
  };
  cancelToken?: string;
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
  verify = await import("@/lib/email-verify");
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
// No token: booking is public. `ip` varies the client so the throttle can't leak between tests.
const post = (body: unknown, ip = "10.0.0.1") =>
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

describe("POST /api/reservations - Gmail variants are one person", () => {
  const gmail = { fullName: "Igli Hoxha", email: "igliihoxha@gmail.com" };
  const dotted = { fullName: "Igli Hoxha", email: "igli.iho.xha@gmail.com" };

  it("counts a dotted variant into the same back-to-back run", async () => {
    expect((await post({ ...ok, ...gmail })).status).toBe(201);
    // 15:00-16:00 straight after, so the run is 2h and the note becomes required.
    const res = await post({
      ...ok,
      ...dotted,
      start: "15:00",
      end: "16:00",
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.field).toBe("note");
    expect(body.error).toContain("back to back");
  });

  it("counts a plus tag into the same run", async () => {
    expect((await post({ ...ok, ...gmail })).status).toBe(201);
    const res = await post({
      ...ok,
      email: "igliihoxha+booth@gmail.com",
      start: "15:00",
      end: "16:00",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("back to back");
  });

  it("409s a dotted variant trying to hold a second booth at the same time", async () => {
    expect((await post({ ...ok, ...gmail })).status).toBe(201);
    const res = await post({ ...ok, ...dotted, boothId: "booth-2" });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toContain("already have a reservation");
  });

  it("still treats a different mailbox as a different person", async () => {
    expect((await post({ ...ok, ...gmail })).status).toBe(201);
    const res = await post({
      ...ok,
      fullName: "Someone Else",
      email: "someoneelse@gmail.com",
      start: "15:00",
      end: "16:00",
    });
    expect(res.status).toBe(201);
  });

  it("keeps dots meaningful outside Gmail", async () => {
    expect(
      (await post({ ...ok, fullName: "Ada L", email: "a.b@outlook.com" }))
        .status,
    ).toBe(201);
    const res = await post({
      ...ok,
      fullName: "Ada L",
      email: "ab@outlook.com",
      boothId: "booth-2",
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/reservations - cancel token for the booking browser", () => {
  it("returns a token naming that reservation, so the board can cancel it", async () => {
    const res = await post(ok);
    expect(res.status).toBe(201);
    const body = await json(res);
    const auth = await import("@/lib/auth");
    expect(body.cancelToken).toBeTruthy();
    expect(auth.verifyCancelToken(body.cancelToken)).toBe(body.reservation?.id);
  });
  it("mints a token that dies with the slot, exactly like the emailed one", async () => {
    const body = await json(await post(ok));
    const auth = await import("@/lib/auth");
    // One minute past the 15:00 end: the slot has gone, so its token must go too.
    vi.setSystemTime(new Date(`${DAY}T15:01:00`));
    expect(auth.verifyCancelToken(body.cancelToken)).toBeNull();
  });
  it("is accepted by the cancel route and frees the slot", async () => {
    const body = await json(await post(ok));
    const cancel = await import("@/app/api/cancel/route");
    const res = await cancel.POST(
      makeRequest("/api/cancel", {
        method: "POST",
        body: { token: body.cancelToken },
      }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).ok).toBe(true);
    const row = await db.getReservation(body.reservation!.id!);
    expect(row?.status).toBe("cancelled");
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
    const body = await json(res);
    expect(body.error).toContain("note");
    // Named so the form can focus the note box instead of stranding the message.
    expect(body.field).toBe("note");
  });
  it("400 for an over-long note", async () => {
    const res = await post({ ...ok, note: "x".repeat(501) });
    expect(res.status).toBe(400);
    expect((await json(res)).field).toBe("note");
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
  it("502 and saves nothing when the confirmation cannot be sent", async () => {
    vi.mocked(email.sendReservationEmail).mockResolvedValueOnce("failed");
    const res = await post(ok);
    expect(res.status).toBe(502);
    expect((await json(res)).error).toContain("nothing was reserved");

    // Gone, not soft-deleted: a held slot nobody was told about is worse than no booking at all.
    expect((await db.queryReservations({ filter: "all" })).total).toBe(0);
  });

  it("frees the slot again after a failed send", async () => {
    vi.mocked(email.sendReservationEmail).mockResolvedValueOnce("failed");
    expect((await post(ok)).status).toBe(502);
    // The very same slot must still be bookable by the next person.
    expect((await post(ok)).status).toBe(201);
  });

  it("still books when email is switched off (no API key)", async () => {
    vi.mocked(email.sendReservationEmail).mockResolvedValueOnce("skipped");
    expect((await post(ok)).status).toBe(201);
    expect((await db.queryReservations({ filter: "all" })).total).toBe(1);
  });

  it("400 and saves nothing when the domain takes no mail", async () => {
    vi.mocked(verify.checkEmailDeliverable).mockResolvedValueOnce({
      ok: false,
      error: "That email domain doesn't accept mail. Please check it.",
    });
    const res = await post(ok);
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.field).toBe("email"); // so the form can point at the right box
    expect(body.error).toContain("accept mail");
    expect((await db.queryReservations({ filter: "all" })).total).toBe(0);
  });

  // Checked before the insert, so a dead address never holds a slot even briefly.
  it("does not send anything when the domain is rejected", async () => {
    vi.mocked(verify.checkEmailDeliverable).mockResolvedValueOnce({
      ok: false,
      error: "nope",
    });
    await post(ok);
    expect(email.sendReservationEmail).not.toHaveBeenCalled();
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
    const ip = "10.0.0.9";
    // Back-to-back quarter-hours: half-open ranges don't clash, so only the throttle can reject one.
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
    expect((await post(ok, "10.0.0.2")).status).toBe(201);
  });
});

// The booking throttle keys on the IP alone, so a forgeable one meant no throttle at all.
describe("POST /api/reservations - a forged address header cannot escape the throttle", () => {
  const SECRET = "proof-secret";
  const hhmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  beforeEach(() => vi.stubEnv("TRUSTED_PROXY_SECRET", SECRET));

  /** One booking per call, each from a "different" forged address but the one real peer. */
  const bookAs = (i: number, cfIp: string, proof?: string) =>
    route.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        body: {
          ...ok,
          date: "2026-07-17",
          start: hhmm(9 * 60 + i * 15),
          end: hhmm(9 * 60 + i * 15 + 15),
          email: `spoof${i}@example.com`,
        },
        headers: {
          "cf-connecting-ip": cfIp,
          "fly-client-ip": "198.51.100.9",
          ...(proof ? { "x-origin-proof": proof } : {}),
        },
      }),
    );

  it("counts every unproven attempt against the real peer, not the address it claims", async () => {
    // 20 accepted = LOGIN_IP_MAX_ATTEMPTS in the test baseline, each claiming a fresh address.
    for (let i = 0; i < 20; i++) {
      expect((await bookAs(i, `203.0.113.${i}`)).status).toBe(201);
    }
    const res = await bookAs(20, "203.0.113.99");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("still gives a proven Cloudflare visitor their own budget", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await bookAs(i, "203.0.113.1", SECRET)).status).toBe(201);
    }
    // A genuinely different visitor, proven by the header, starts fresh rather than inheriting the block.
    expect((await bookAs(20, "203.0.113.2", SECRET)).status).toBe(201);
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
    // A plain stub, not vi.fn(): a tracked rejection resurfaces as an unhandled error.
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

  // The token is single-use, so it must not be spent on a request that was never going to succeed.
  it("does not call siteverify when the slot itself is invalid", async () => {
    enable();
    siteverify(true);
    expect(
      (await post({ ...ok, start: "14:07", turnstileToken: "good" })).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/reservations - back-to-back runs count as one sitting", () => {
  // Splitting a long stay into short bookings must not dodge the 2 hour rules.
  const at = (
    start: string,
    end: string,
    extra: Record<string, unknown> = {},
  ) => post({ ...ok, start, end, ...extra }, "run-ip");

  it("confirms a lone hour with no note", async () => {
    const res = await at("14:00", "15:00");
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("confirmed");
  });

  it("requires a note on the hour that takes the run to the limit", async () => {
    expect((await at("14:00", "15:00")).status).toBe(201);
    const res = await at("15:00", "16:00", { boothId: "booth-2" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("back to back");
  });

  it("confirms that second hour once a note is given", async () => {
    expect((await at("14:00", "15:00")).status).toBe(201);
    const res = await at("15:00", "16:00", {
      boothId: "booth-2",
      note: "Workshop",
    });
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("confirmed");
  });

  // A gap nobody else could book is not a break: the tolerance is MIN_RESERVATION_MINUTES.
  it("closes a 5 minute gap: still one sitting", async () => {
    expect((await at("14:00", "15:00")).status).toBe(201);
    const res = await at("15:05", "16:05", { boothId: "booth-2" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("back to back");
  });

  it("closes a 15 minute gap, the largest unbookable one", async () => {
    expect((await at("14:00", "15:00")).status).toBe(201);
    const res = await at("15:15", "16:15", { boothId: "booth-2" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("back to back");
  });

  it("lets a 20 minute gap break the run: that is bookable time left free", async () => {
    expect((await at("14:00", "15:00")).status).toBe(201);
    const res = await at("15:20", "16:20", { boothId: "booth-2" });
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("confirmed");
  });

  it("counts a gapped run for approval too, not just the note", async () => {
    expect((await at("14:00", "15:00")).status).toBe(201);
    // 60 held + 65 booked = 2h05 across a 5 minute gap, past the 2 hour auto-approve limit.
    const res = await at("15:05", "16:10", {
      boothId: "booth-2",
      note: "Workshop",
    });
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("pending");
  });

  it("needs admin approval once the run passes the limit", async () => {
    expect((await at("14:00", "15:00")).status).toBe(201);
    expect(
      (await at("15:00", "16:00", { boothId: "booth-2", note: "Workshop" }))
        .status,
    ).toBe(201);
    // Third hour: the run is now 3 hours, past the 2 hour auto-approve limit.
    const res = await at("16:00", "17:00", {
      boothId: "booth-3",
      note: "Workshop",
    });
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("pending");
  });

  it("does not chain bookings with a real gap between them", async () => {
    expect((await at("14:00", "15:00")).status).toBe(201);
    // 16:00 leaves a bookable hour clear, so this stands on its own.
    const res = await at("16:00", "17:00", { boothId: "booth-2" });
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("confirmed");
  });

  it("counts another person's adjacent booking against nobody", async () => {
    expect((await at("14:00", "15:00")).status).toBe(201);
    const res = await post(
      {
        ...ok,
        start: "15:00",
        end: "16:00",
        boothId: "booth-2",
        fullName: "Grace Hopper",
        email: "grace@example.com",
      },
      "run-ip",
    );
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("confirmed");
  });

  it("matches the email case-insensitively", async () => {
    expect((await at("14:00", "15:00")).status).toBe(201);
    const res = await at("15:00", "16:00", {
      boothId: "booth-2",
      email: "ADA@Example.com",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("back to back");
  });
});

describe("POST /api/reservations - an unexpected failure is not a 500", () => {
  it("400s with a safe message, leaking no SQL or stack", async () => {
    vi.spyOn(db, "createReservation").mockRejectedValueOnce(
      new Error("SQLITE_CORRUPT: database disk image is malformed"),
    );
    const res = await post(ok, "boom-ip");
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("Could not create the reservation.");
    expect(body.error).not.toContain("SQLITE");
    vi.restoreAllMocks();
  });
});

describe("GET /api/reservations - the status filter", () => {
  it("falls back to 'all' for a status it does not recognise", async () => {
    await post(ok);
    const list = async (qs: string) =>
      json(
        await route.GET(
          makeRequest(`/api/reservations?${qs}`, { token: adminToken() }),
        ),
      );
    // A junk filter must not silently return nothing, nor 500.
    expect((await list("status=bogus")).total).toBe(1);
    expect((await list("status=all")).total).toBe(1);
    expect((await list("status=cancelled")).total).toBe(0);
  });
});
