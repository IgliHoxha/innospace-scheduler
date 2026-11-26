import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminToken,
  insertReservation,
  makeRequest,
  memberToken,
  resetApp,
} from "../helpers/app";
import { settled } from "../helpers/after";
import type { ActiveStatus, ReservationInput } from "@/lib/types";

vi.mock("@/lib/slack", () => ({
  postReservationToSlack: vi.fn().mockResolvedValue("sent"),
}));

vi.mock("@/lib/email", () => ({
  sendGuestCancellationEmail: vi.fn().mockResolvedValue("sent"),
}));

type List = typeof import("@/app/api/me/reservations/route");
type One = typeof import("@/app/api/me/reservations/[id]/route");
type Db = typeof import("@/lib/db");
type Slack = typeof import("@/lib/slack");
type Email = typeof import("@/lib/email");
let list: List;
let one: One;
let db: Db;
let slack: Slack;
let email: Email;

const D = "2026-07-16";
const at = (t: string) => `${D}T${t}`;
const ADA = memberToken("Ada Lovelace", "ada@example.com");
const GRACE = memberToken("Grace Hopper", "grace@example.com", "google-sub-2");

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${D}T12:02:00`));
  resetApp();
  db = await import("@/lib/db");
  list = await import("@/app/api/me/reservations/route");
  one = await import("@/app/api/me/reservations/[id]/route");
  slack = await import("@/lib/slack");
  vi.mocked(slack.postReservationToSlack).mockClear();
  email = await import("@/lib/email");
  vi.mocked(email.sendGuestCancellationEmail).mockClear();
});

const seed = (
  start: string,
  end: string,
  over: Partial<ReservationInput> = {},
  status: ActiveStatus = "confirmed",
) =>
  insertReservation(
    db,
    {
      boothId: "booth-1",
      startsAt: at(start),
      endsAt: at(end),
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      ...over,
    },
    status,
  );

const getList = (token?: string, page?: number) =>
  list.GET(
    makeRequest(`/api/me/reservations${page ? `?page=${page}` : ""}`, {
      token,
    }),
  );

const call = (
  method: "DELETE" | "PATCH",
  id: string,
  token?: string,
  body?: unknown,
) =>
  settled(
    one[method](
      makeRequest(`/api/me/reservations/${id}`, { method, token, body }),
      { params: Promise.resolve({ id }) },
    ),
  );

const json = (res: Response) =>
  res.json() as Promise<{
    ok: boolean;
    error?: string;
    reservation?: { endsAt: string; status: string };
  }>;

describe("GET /api/me/reservations", () => {
  const ids = (body: { bookings: { id: string }[] }) =>
    body.bookings.map((b) => b.id);

  it("lists the member's bookings by phase, with the facts the page shows", async () => {
    const past = await seed("08:00", "09:00", { note: "  standup  " });
    const now = await seed("11:30", "12:30");
    const later = await seed("15:00", "16:00", { boothId: "booth-2" });
    await seed("17:00", "18:00", { email: "grace@example.com" });

    const res = await getList(ADA);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      now: at("12:02"),
      page: 1,
      pageSize: 10,
      total: 3,
    });
    expect(
      body.bookings.map((b: { id: string; phase: string }) => [b.id, b.phase]),
    ).toEqual([
      [now.id, "ongoing"],
      [later.id, "upcoming"],
      [past.id, "past"],
    ]);
    expect(body.bookings[2]).toEqual({
      id: past.id,
      boothName: "Booth 1",
      startsAt: at("08:00"),
      endsAt: at("09:00"),
      status: "confirmed",
      phase: "past",
      createdAt: past.createdAt,
      note: "standup",
    });
    expect(body.bookings[0]).not.toHaveProperty("note");
    // Nothing that names the booker goes back: the session already knows them.
    expect(body.bookings[0]).not.toHaveProperty("email");
  });

  it("pages ten at a time", async () => {
    // Twelve past hours, so the order is simply newest first.
    const made = [];
    for (let h = 0; h < 12; h++) {
      made.push(
        await seed(
          `${String(h).padStart(2, "0")}:00`,
          `${String(h).padStart(2, "0")}:30`,
        ),
      );
    }
    const newestFirst = made.map((r) => r.id).reverse();
    const first = await (await getList(ADA)).json();
    expect(ids(first)).toEqual(newestFirst.slice(0, 10));
    expect(first.total).toBe(12);
    const second = await (await getList(ADA, 2)).json();
    expect(second.page).toBe(2);
    expect(ids(second)).toEqual(newestFirst.slice(10));
  });

  it("lands a page past the end on the last one, and a junk page on the first", async () => {
    await seed("15:00", "16:00");
    for (const asked of [9, 2]) {
      const body = await (await getList(ADA, asked)).json();
      expect(body.page).toBe(1);
      expect(body.bookings).toHaveLength(1);
    }
    for (const junk of ["0", "-3", "1.5", "abc"]) {
      const res = await list.GET(
        makeRequest(`/api/me/reservations?page=${junk}`, { token: ADA }),
      );
      expect((await res.json()).page).toBe(1);
    }
  });

  it("answers an empty first page for a member with no bookings", async () => {
    const body = await (await getList(GRACE)).json();
    expect(body).toMatchObject({ page: 1, total: 0, bookings: [] });
  });

  it("refuses a guest, the admin and a forged cookie", async () => {
    for (const token of [undefined, adminToken(), "not.a.token"]) {
      const res = await getList(token);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});

describe("DELETE /api/me/reservations/[id]", () => {
  it("cancels an upcoming booking and tells the channel", async () => {
    const r = await seed("15:00", "16:00");
    const res = await call("DELETE", r.id, ADA);
    expect(res.status).toBe(200);
    expect((await json(res)).reservation?.status).toBe("cancelled");
    expect(db.getReservation(r.id)?.status).toBe("cancelled");
    expect(slack.postReservationToSlack).toHaveBeenCalledWith(
      expect.objectContaining({ id: r.id, status: "cancelled" }),
      "cancelled",
      expect.any(Function),
      "guest",
    );
  });

  it("emails the member a receipt that takes it off their calendar", async () => {
    const r = await seed("15:00", "16:00");
    await call("DELETE", r.id, ADA);
    expect(email.sendGuestCancellationEmail).toHaveBeenCalledOnce();
    const [dates] = vi.mocked(email.sendGuestCancellationEmail).mock.calls[0];
    expect(dates.map((d) => [d.id, d.status])).toEqual([[r.id, "cancelled"]]);
  });

  it("emails nothing when the cancel is refused", async () => {
    const over = await seed("08:00", "09:00");
    await call("DELETE", over.id, ADA);
    const theirs = await seed("15:00", "16:00", { email: "grace@example.com" });
    await call("DELETE", theirs.id, ADA);
    expect(email.sendGuestCancellationEmail).not.toHaveBeenCalled();
  });

  it("emails nothing when a booking is ended early", async () => {
    const r = await seed("11:30", "12:30");
    await call("PATCH", r.id, ADA);
    expect(email.sendGuestCancellationEmail).not.toHaveBeenCalled();
  });

  it("cancels a pending request too", async () => {
    const r = await seed("15:00", "16:00", {}, "pending");
    expect((await call("DELETE", r.id, ADA)).status).toBe(200);
    expect(db.getReservation(r.id)?.status).toBe("cancelled");
  });

  it("cancels a booking under way, freeing the rest of its time", async () => {
    const r = await seed("11:30", "12:30");
    const res = await call("DELETE", r.id, ADA);
    expect(res.status).toBe(200);
    expect(db.getReservation(r.id)?.status).toBe("cancelled");
    expect(db.reservedRanges("booth-1", D)).toEqual([]);
    expect(email.sendGuestCancellationEmail).toHaveBeenCalledOnce();
  });

  it("refuses a booking that is already over", async () => {
    const r = await seed("08:00", "09:00");
    const res = await call("DELETE", r.id, ADA);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(
      "A booking that is already over can't be cancelled.",
    );
    expect(db.getReservation(r.id)?.status).toBe("confirmed");
  });

  // Half-open: at its end minute it is already over.
  it("refuses at the very minute it ends", async () => {
    vi.setSystemTime(new Date(`${D}T12:30:00`));
    const r = await seed("11:30", "12:30");
    expect((await call("DELETE", r.id, ADA)).status).toBe(400);
  });

  it("answers 409 for one already cancelled", async () => {
    const r = await seed("15:00", "16:00");
    db.updateReservationStatus(r.id, "cancelled");
    expect((await call("DELETE", r.id, ADA)).status).toBe(409);
  });

  it("treats someone else's booking as missing", async () => {
    const r = await seed("15:00", "16:00");
    const res = await call("DELETE", r.id, GRACE);
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("That booking was not found.");
    expect(db.getReservation(r.id)?.status).toBe("confirmed");
  });

  it("finds a booking made under another spelling of the same mailbox", async () => {
    const r = await seed("15:00", "16:00", { email: "a.da@gmail.com" });
    const token = memberToken("Ada", "ada@gmail.com");
    expect((await call("DELETE", r.id, token)).status).toBe(200);
  });

  it("refuses without a member session, and a soft-deleted or unknown id", async () => {
    const r = await seed("15:00", "16:00");
    expect((await call("DELETE", r.id)).status).toBe(401);
    expect((await call("DELETE", r.id, adminToken())).status).toBe(401);
    db.updateReservationStatus(r.id, "deleted");
    expect((await call("DELETE", r.id, ADA)).status).toBe(404);
    expect((await call("DELETE", "nope", ADA)).status).toBe(404);
    expect(slack.postReservationToSlack).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/me/reservations/[id]", () => {
  const endNow = (
    id: string,
    token: string | undefined = ADA,
    body?: unknown,
  ) => call("PATCH", id, token, body);

  it("ends a booking under way at the server's minute and tells the channel", async () => {
    const r = await seed("11:30", "12:30");
    const res = await endNow(r.id);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      ok: true,
      reservation: { endsAt: at("12:02"), status: "confirmed" },
    });
    expect(db.getReservation(r.id)).toMatchObject({
      startsAt: at("11:30"),
      endsAt: at("12:02"),
      status: "confirmed",
    });
    expect(slack.postReservationToSlack).toHaveBeenCalledWith(
      expect.objectContaining({ endsAt: at("12:02") }),
      "endedEarly",
      expect.any(Function),
      "guest",
    );
  });

  it("moves it to the past and frees the rest of its time", async () => {
    const r = await seed("11:30", "12:30");
    await endNow(r.id);
    const body = await (await getList(ADA)).json();
    expect(body.bookings).toEqual([
      expect.objectContaining({
        id: r.id,
        phase: "past",
        endsAt: at("12:02"),
      }),
    ]);
    expect(db.reservedRanges("booth-1", D)).toEqual([
      { startsAt: at("11:30"), endsAt: at("12:02") },
    ]);
    const next = await seed("12:05", "12:30", { email: "grace@example.com" });
    expect(next.status).toBe("confirmed");
  });

  // The clock decides: a caller cannot pick an end, later or earlier.
  it("ignores an end the caller sends", async () => {
    const r = await seed("11:30", "12:30");
    expect((await endNow(r.id, ADA, { end: "13:00" })).status).toBe(200);
    expect(db.getReservation(r.id)?.endsAt).toBe(at("12:02"));
  });

  it("ends a pending request the same way, leaving it pending", async () => {
    const r = await seed("11:30", "14:30", { note: "workshop" }, "pending");
    expect((await endNow(r.id)).status).toBe(200);
    expect(db.getReservation(r.id)).toMatchObject({
      endsAt: at("12:02"),
      status: "pending",
    });
  });

  it("has nothing left to end a second time", async () => {
    const r = await seed("11:30", "12:30");
    await endNow(r.id);
    vi.mocked(slack.postReservationToSlack).mockClear();
    const res = await endNow(r.id);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(
      "Only a booking that is under way can be ended early.",
    );
    expect(slack.postReservationToSlack).not.toHaveBeenCalled();
  });

  // A booking cannot be zero minutes long, and one that used no time is a cancel.
  it("cancels one ended in the very minute it began, with the cancel's receipt", async () => {
    vi.setSystemTime(new Date(`${D}T11:30:40`));
    const r = await seed("11:30", "12:30");
    const res = await endNow(r.id);
    expect(res.status).toBe(200);
    expect((await json(res)).reservation?.status).toBe("cancelled");
    expect(db.getReservation(r.id)).toMatchObject({
      status: "cancelled",
      endsAt: at("12:30"),
    });
    expect(db.reservedRanges("booth-1", D)).toEqual([]);
    expect(email.sendGuestCancellationEmail).toHaveBeenCalledOnce();
    expect(slack.postReservationToSlack).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
      "cancelled",
      expect.any(Function),
      "guest",
    );
  });

  it("keeps a one-minute stay as a booking", async () => {
    vi.setSystemTime(new Date(`${D}T11:31:00`));
    const r = await seed("11:30", "12:30");
    expect((await endNow(r.id)).status).toBe(200);
    expect(db.getReservation(r.id)).toMatchObject({
      status: "confirmed",
      endsAt: at("11:31"),
    });
  });

  it("refuses a booking not under way", async () => {
    for (const [s, e] of [
      ["15:00", "16:00"],
      ["08:00", "09:00"],
    ]) {
      const r = await seed(s, e);
      const res = await endNow(r.id);
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe(
        "Only a booking that is under way can be ended early.",
      );
      expect(db.getReservation(r.id)?.endsAt).toBe(at(e));
    }
    expect(slack.postReservationToSlack).not.toHaveBeenCalled();
  });

  // Half-open: at its end minute it is already over.
  it("refuses at the very minute it ends", async () => {
    vi.setSystemTime(new Date(`${D}T12:30:00`));
    const r = await seed("11:30", "12:30");
    expect((await endNow(r.id)).status).toBe(400);
  });

  it("treats someone else's booking as missing, and refuses a guest", async () => {
    const r = await seed("11:30", "12:30");
    expect((await endNow(r.id, GRACE)).status).toBe(404);
    expect((await call("PATCH", r.id)).status).toBe(401);
    expect((await call("PATCH", r.id, adminToken())).status).toBe(401);
    expect((await endNow("nope")).status).toBe(404);
    expect(db.getReservation(r.id)?.endsAt).toBe(at("12:30"));
  });

  it("answers 409 for a cancelled booking", async () => {
    const r = await seed("11:30", "12:30");
    db.updateReservationStatus(r.id, "cancelled");
    expect((await endNow(r.id)).status).toBe(409);
  });
});
