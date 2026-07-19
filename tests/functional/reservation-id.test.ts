import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminToken,
  makeRequest,
  params,
  resetApp,
  userToken,
} from "../helpers/app";

vi.mock("@/lib/email", () => ({
  sendReservationEmail: vi.fn().mockResolvedValue(undefined),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

type Route = typeof import("@/app/api/reservations/[id]/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
let route: Route;
let db: Db;
let email: Email;

const DAY = "2026-07-16";

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/reservations/[id]/route");
  email = await import("@/lib/email");
});

const seed = (userId = "u1", status: "confirmed" | "pending" = "confirmed") =>
  db.createReservation(
    {
      boothId: "booth-1",
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T15:00`,
      userId,
      fullName: "Ada",
      email: "ada@example.com",
    },
    status,
  );

const patch = (id: string, body: unknown, tok?: string) =>
  route.PATCH(
    makeRequest(`/api/reservations/${id}`, {
      method: "PATCH",
      body,
      token: tok,
    }),
    params({ id }),
  );

describe("PATCH /api/reservations/[id]", () => {
  it("401 without a session", async () => {
    const r = await seed();
    expect((await patch(r.id, { status: "cancelled" })).status).toBe(401);
  });

  it("400 on a malformed JSON body (parse falls back to empty)", async () => {
    const res = await route.PATCH(
      makeRequest("/api/reservations/any", {
        method: "PATCH",
        rawBody: "{ not json",
        token: adminToken(),
      }),
      params({ id: "any" }),
    );
    expect(res.status).toBe(400);
  });

  it("400 for an invalid status", async () => {
    const r = await seed();
    expect((await patch(r.id, { status: "bogus" }, adminToken())).status).toBe(
      400,
    );
  });

  it("400 for an over-long email body", async () => {
    const res = await patch(
      "any",
      { status: "confirmed", emailBody: "x".repeat(5001) },
      adminToken(),
    );
    expect(res.status).toBe(400);
  });

  it("404 for a missing reservation", async () => {
    expect(
      (await patch("ghost", { status: "cancelled" }, adminToken())).status,
    ).toBe(404);
  });

  it("403 when a member cancels someone else's booking", async () => {
    const r = await seed("u2");
    expect(
      (await patch(r.id, { status: "cancelled" }, userToken("u1"))).status,
    ).toBe(403);
  });

  it("403 when a member sets any status other than cancelled", async () => {
    const r = await seed("u1");
    expect(
      (await patch(r.id, { status: "confirmed" }, userToken("u1"))).status,
    ).toBe(403);
  });

  it("lets a member cancel their own booking and emails a cancellation", async () => {
    const r = await seed("u1");
    const res = await patch(r.id, { status: "cancelled" }, userToken("u1"));
    expect(res.status).toBe(200);
    expect(vi.mocked(email.sendReservationEmail).mock.calls[0][1]).toBe(
      "cancelled",
    );
  });

  it("lets an admin confirm a pending booking and emails a confirmation", async () => {
    const r = await seed("u1", "pending");
    const res = await patch(r.id, { status: "confirmed" }, adminToken());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reservation: { status: string } };
    expect(body.reservation.status).toBe("confirmed");
    expect(vi.mocked(email.sendReservationEmail).mock.calls[0][1]).toBe(
      "confirmed",
    );
  });

  it("does not email on a deleted status change", async () => {
    const r = await seed("u1");
    await patch(r.id, { status: "deleted" }, adminToken());
    expect(email.sendReservationEmail).not.toHaveBeenCalled();
  });
});
