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
      stepMinutes: 5,
      minMinutes: 15,
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
    const started = await seed("11:30", "12:30");
    await call("DELETE", started.id, ADA);
    const theirs = await seed("15:00", "16:00", { email: "grace@example.com" });
    await call("DELETE", theirs.id, ADA);
    expect(email.sendGuestCancellationEmail).not.toHaveBeenCalled();
  });

  it("emails nothing when the end time moves", async () => {
    const r = await seed("11:30", "12:30");
    await call("PATCH", r.id, ADA, { end: "13:00" });
    expect(email.sendGuestCancellationEmail).not.toHaveBeenCalled();
  });

  it("cancels a pending request too", async () => {
    const r = await seed("15:00", "16:00", {}, "pending");
    expect((await call("DELETE", r.id, ADA)).status).toBe(200);
    expect(db.getReservation(r.id)?.status).toBe("cancelled");
  });

  it("refuses a booking already under way or over", async () => {
    for (const [s, e] of [
      ["11:30", "12:30"],
      ["08:00", "09:00"],
    ]) {
      const r = await seed(s, e);
      const res = await call("DELETE", r.id, ADA);
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe(
        "A booking that has already started can't be cancelled.",
      );
      expect(db.getReservation(r.id)?.status).toBe("confirmed");
    }
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
  const move = (id: string, end: unknown, token = ADA) =>
    call("PATCH", id, token, { end });

  it("extends a booking under way and tells the channel", async () => {
    const r = await seed("11:30", "12:30");
    const res = await move(r.id, "13:00");
    expect(res.status).toBe(200);
    expect((await json(res)).reservation?.endsAt).toBe(at("13:00"));
    expect(db.getReservation(r.id)?.endsAt).toBe(at("13:00"));
    expect(slack.postReservationToSlack).toHaveBeenCalledWith(
      expect.objectContaining({ endsAt: at("13:00") }),
      "endChanged",
      expect.any(Function),
      "guest",
    );
  });

  it("shortens one, down to the next step after now", async () => {
    const r = await seed("11:30", "12:30");
    expect((await move(r.id, "12:05")).status).toBe(200);
    expect(db.getReservation(r.id)?.endsAt).toBe(at("12:05"));
  });

  it("refuses an end that is not later than now", async () => {
    const r = await seed("11:30", "12:30");
    const res = await move(r.id, "12:00");
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe(
      "The new end time must be later than now.",
    );
  });

  it("refuses an end off the grid, malformed or missing", async () => {
    const r = await seed("11:30", "12:30");
    for (const end of ["12:33", "1pm", "", 1300, undefined, "23:59"]) {
      const res = await move(r.id, end);
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe(
        "Please choose times in 5-minute steps.",
      );
    }
    expect(db.getReservation(r.id)?.endsAt).toBe(at("12:30"));
  });

  it("refuses an end before the start or under the minimum length", async () => {
    vi.setSystemTime(new Date(`${D}T11:31:00`));
    const r = await seed("11:30", "12:30");
    expect((await json(await move(r.id, "11:00"))).error).toBe(
      "The end time must be after the start time.",
    );
    expect((await json(await move(r.id, "11:40"))).error).toBe(
      "Reservations must be at least 15 minutes long.",
    );
  });

  it("answers ok without a change when the end is the same", async () => {
    const r = await seed("11:30", "12:30");
    const res = await move(r.id, "12:30");
    expect(res.status).toBe(200);
    expect(slack.postReservationToSlack).not.toHaveBeenCalled();
  });

  it("answers 409 when the longer stay runs into the next booking", async () => {
    const r = await seed("11:30", "12:30");
    await seed("13:00", "14:00", { email: "grace@example.com" });
    const res = await move(r.id, "13:15");
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe(
      "That time slot is no longer available.",
    );
    expect(db.getReservation(r.id)?.endsAt).toBe(at("12:30"));
  });

  it("answers 409 when it would overlap the member's own booking on another booth", async () => {
    const r = await seed("11:30", "12:30");
    await seed("12:45", "13:30", { boothId: "booth-2" });
    expect((await move(r.id, "13:00")).status).toBe(409);
  });

  it("will not stretch a confirmed stay past the approval limit", async () => {
    const r = await seed("11:30", "12:30", { note: "workshop" });
    const res = await move(r.id, "13:45");
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("needs admin approval");
  });

  it("counts a back-to-back booking towards that limit", async () => {
    await seed("10:30", "11:30", { boothId: "booth-2", note: "prep" });
    const r = await seed("11:30", "12:30", { note: "workshop" });
    expect((await json(await move(r.id, "12:45"))).error).toContain(
      "needs admin approval",
    );
  });

  it("will not reach the note limit for a booking with no note", async () => {
    const r = await seed("11:30", "12:30");
    const res = await move(r.id, "13:30");
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("needs a note");
  });

  it("lets a booking with a note reach the limit exactly", async () => {
    const r = await seed("11:30", "12:30", { note: "workshop" });
    expect((await move(r.id, "13:30")).status).toBe(200);
  });

  it("lets a pending one, already waiting on the admin, run longer", async () => {
    const r = await seed("11:30", "14:00", { note: "workshop" }, "pending");
    expect((await move(r.id, "14:30")).status).toBe(200);
  });

  it("always lets a stay already past the limit shrink", async () => {
    const r = await seed("09:00", "13:00", { note: "workshop" });
    expect((await move(r.id, "12:30")).status).toBe(200);
  });

  it("refuses a booking not under way", async () => {
    for (const [s, e] of [
      ["15:00", "16:00"],
      ["08:00", "09:00"],
    ]) {
      const r = await seed(s, e);
      const res = await move(r.id, "16:30");
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe(
        "Only a booking that is under way can change its end time.",
      );
    }
  });

  it("treats someone else's booking as missing, and refuses a guest", async () => {
    const r = await seed("11:30", "12:30");
    expect((await move(r.id, "13:00", GRACE)).status).toBe(404);
    expect(
      (await call("PATCH", r.id, undefined, { end: "13:00" })).status,
    ).toBe(401);
    expect(db.getReservation(r.id)?.endsAt).toBe(at("12:30"));
  });

  it("answers 409 for a cancelled booking", async () => {
    const r = await seed("11:30", "12:30");
    db.updateReservationStatus(r.id, "cancelled");
    expect((await move(r.id, "13:00")).status).toBe(409);
  });
});
