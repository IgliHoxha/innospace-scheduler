import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminToken, makeRequest, params, resetApp } from "../helpers/app";

vi.mock("@/lib/email", () => ({
  sendReservationEmail: vi.fn().mockResolvedValue(undefined),
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

const seed = (status: "confirmed" | "pending" = "confirmed") =>
  db.createReservation(
    {
      boothId: "booth-1",
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T15:00`,
      fullName: "Ada Lovelace",
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
  it("401 without an admin session", async () => {
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

  it("lets an admin cancel a reservation and emails the booker", async () => {
    const r = await seed();
    const res = await patch(r.id, { status: "cancelled" }, adminToken());
    expect(res.status).toBe(200);
    expect(vi.mocked(email.sendReservationEmail).mock.calls[0][1]).toBe(
      "cancelled",
    );
  });

  it("lets an admin confirm a pending reservation and emails a confirmation", async () => {
    const r = await seed("pending");
    const res = await patch(r.id, { status: "confirmed" }, adminToken());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reservation: { status: string } };
    expect(body.reservation.status).toBe("confirmed");
    expect(vi.mocked(email.sendReservationEmail).mock.calls[0][1]).toBe(
      "confirmed",
    );
  });

  it("does not email on a deleted status change", async () => {
    const r = await seed();
    await patch(r.id, { status: "deleted" }, adminToken());
    expect(email.sendReservationEmail).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/reservations/[id] - failures that must not lose the change", () => {
  it("404s when the row is deleted between the read and the write", async () => {
    const r = await seed("pending");
    vi.spyOn(db, "updateReservationStatus").mockImplementation(async (id) => {
      await db.discardReservation(id);
      return null;
    });
    const res = await patch(r.id, { status: "confirmed" }, adminToken());
    expect(res.status).toBe(404);
    vi.restoreAllMocks();
  });

  it("still confirms when the notification email throws", async () => {
    const r = await seed("pending");
    vi.mocked(email.sendReservationEmail).mockRejectedValueOnce(
      new Error("resend is down"),
    );
    const res = await patch(r.id, { status: "confirmed" }, adminToken());
    // The status change is the point; the email is best effort.
    expect(res.status).toBe(200);
    expect((await db.getReservation(r.id))?.status).toBe("confirmed");
  });
});

describe("PATCH /api/reservations/[id] - statuses that send no email", () => {
  it("soft-deletes without emailing anyone", async () => {
    const r = await seed();
    const res = await patch(r.id, { status: "deleted" }, adminToken());
    expect(res.status).toBe(200);
    expect((await db.getReservation(r.id))?.status).toBe("deleted");
    expect(email.sendReservationEmail).not.toHaveBeenCalled();
  });
});
