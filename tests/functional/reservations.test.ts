import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminToken, makeRequest, memberToken, resetApp } from "../helpers/app";

// DNS is stubbed: the suite must never do a real lookup.
vi.mock("@/lib/email-verify", () => ({
  checkEmailDeliverable: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/email", () => ({
  sendReservationEmail: vi.fn().mockResolvedValue("sent"),
}));

vi.mock("@/lib/slack", () => ({
  postReservationToSlack: vi.fn().mockResolvedValue("sent"),
}));

type Route = typeof import("@/app/api/reservations/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
type Slack = typeof import("@/lib/slack");
type Verify = typeof import("@/lib/email-verify");
let route: Route;
let db: Db;
let email: Email;
let slack: Slack;
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
  slack = await import("@/lib/slack");
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
// No token: booking is public. `ip` varies so the throttle cannot leak.
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
    const row = db.getReservation(body.reservation!.id!);
    expect(row?.status).toBe("cancelled");
  });
});

// A member's session identifies them; a guest's body does, and cannot repeat.
describe("POST /api/reservations - signed in with Google", () => {
  const asMember = (body: unknown, ip = "10.0.0.9") =>
    route.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        body,
        headers: { "x-real-ip": ip },
        token: memberToken("Ada Lovelace", "ada@example.com"),
      }),
    );
  const slot = { boothId: "booth-1", date: DAY, start: "14:00", end: "15:00" };

  it("books under the session's name and email, with none in the body", async () => {
    const res = await asMember(slot);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.reservation?.fullName).toBe("Ada Lovelace");
    expect(body.reservation?.email).toBe("ada@example.com");
  });

  it("ignores a name or email in the body: Google is the authority", async () => {
    const res = await asMember({
      ...slot,
      fullName: "Mallory Mallory",
      email: "mallory@example.com",
    });
    const body = await json(res);
    expect(body.reservation?.fullName).toBe("Ada Lovelace");
    expect(body.reservation?.email).toBe("ada@example.com");
  });

  it("accepts a one-word Google name, which a guest could not give", async () => {
    const res = await route.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        body: slot,
        headers: { "x-real-ip": "10.0.0.8" },
        token: memberToken("Ada", "ada@example.com"),
      }),
    );
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.fullName).toBe("Ada");
  });

  it("skips the mail-domain check: Google already verified the address", async () => {
    // Not a one-shot: the member path never consumes it, so it would leak.
    vi.mocked(verify.checkEmailDeliverable).mockResolvedValue({
      ok: false,
      error: "no mail",
    });
    expect((await asMember(slot)).status).toBe(201);
    expect(verify.checkEmailDeliverable).not.toHaveBeenCalled();
    vi.mocked(verify.checkEmailDeliverable).mockResolvedValue({ ok: true });
  });

  it("still runs that check for a guest", async () => {
    vi.mocked(verify.checkEmailDeliverable).mockResolvedValueOnce({
      ok: false,
      error: "no mail",
    });
    expect((await post(ok)).status).toBe(400);
  });

  it("treats the admin's session as no booker at all", async () => {
    const res = await route.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        body: slot,
        headers: { "x-real-ip": "10.0.0.7" },
        token: adminToken(),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).field).toBe("fullName");
  });

  it("still cannot hold two booths at once under that email", async () => {
    await asMember(slot);
    const res = await asMember({ ...slot, boothId: "booth-2" });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/reservations - a weekly repeat", () => {
  const asMember = (body: unknown, ip = "10.0.0.9") =>
    route.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        body,
        headers: { "x-real-ip": ip },
        token: memberToken("Ada Lovelace", "ada@example.com"),
      }),
    );
  const slot = { boothId: "booth-1", date: DAY, start: "14:00", end: "15:00" };
  type Made = Body & {
    reservations?: {
      id: string;
      status: string;
      startsAt: string;
      seriesId?: string;
      cancelToken?: string;
    }[];
    seriesCancelToken?: string;
  };
  const made = (res: Response) => res.json() as Promise<Made>;

  it("401s a guest who asks for one, naming the way in", async () => {
    const res = await post({ ...ok, repeatWeeks: 3 });
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe(
      "Sign in with Google to set up a weekly repeat.",
    );
    expect(db.queryReservations({ filter: "all" }).total).toBe(0);
  });

  it("400s a count outside 1 to 8, or not a whole number", async () => {
    for (const bad of [0, 9, 2.5, "x"]) {
      const res = await asMember({ ...slot, repeatWeeks: bad });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe(
        "Choose how many weeks to repeat for, from 1 to 8.",
      );
    }
  });

  it("stores one date a week under a shared series id and returns them all", async () => {
    const res = await asMember({ ...slot, repeatWeeks: 3 });
    expect(res.status).toBe(201);
    const body = await made(res);
    expect(body.reservations?.map((r) => r.startsAt)).toEqual([
      "2026-07-16T14:00",
      "2026-07-23T14:00",
      "2026-07-30T14:00",
    ]);
    const ids = new Set(body.reservations?.map((r) => r.seriesId));
    expect(ids.size).toBe(1);
    expect(body.reservation?.id).toBe(body.reservations?.[0].id);
    expect(db.queryReservations({ filter: "all" }).total).toBe(3);
  });

  it("gates only the first date by the booking window", async () => {
    // Eight weeks runs far past the 14-day window, and is still accepted.
    expect((await asMember({ ...slot, repeatWeeks: 8 })).status).toBe(201);
    const late = await asMember({
      ...slot,
      date: "2026-09-01",
      repeatWeeks: 2,
    });
    expect(late.status).toBe(400);
  });

  it("hands back a cancel token per date and one for the whole series", async () => {
    const body = await made(await asMember({ ...slot, repeatWeeks: 2 }));
    const auth = await import("@/lib/auth");
    for (const r of body.reservations!) {
      expect(auth.verifyCancelToken(r.cancelToken)).toBe(r.id);
    }
    expect(auth.verifySeriesCancelToken(body.seriesCancelToken)).toBe(
      body.reservations![0].seriesId,
    );
    // The series link lasts until the last date ends, a week after the first.
    vi.setSystemTime(new Date("2026-07-23T15:01:00"));
    expect(auth.verifySeriesCancelToken(body.seriesCancelToken)).toBeNull();
  });

  it("sends one email covering every date, and announces each", async () => {
    await asMember({ ...slot, repeatWeeks: 3 });
    expect(email.sendReservationEmail).toHaveBeenCalledOnce();
    const [first, status, custom, series] = vi.mocked(
      email.sendReservationEmail,
    ).mock.calls[0];
    expect(status).toBe("confirmed");
    expect(custom).toBeUndefined();
    expect(series).toHaveLength(3);
    expect(series?.[0].id).toBe(first.id);
    expect(slack.postReservationToSlack).toHaveBeenCalledTimes(3);
  });

  it("409s naming the date when a later week is taken, and stores nothing", async () => {
    db.createReservation({
      boothId: "booth-1",
      startsAt: "2026-07-30T14:30",
      endsAt: "2026-07-30T15:30",
      fullName: "Bob Builder",
      email: "bob@example.com",
    });
    const res = await asMember({ ...slot, repeatWeeks: 3 });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe(
      "Thursday, 30 July 2026: That time slot is no longer available.",
    );
    expect(db.queryReservations({ filter: "all" }).total).toBe(1);
  });

  it("holds every date for approval when one of them joins a long run", async () => {
    // A booking right before the second week's slot makes that week a long run.
    await asMember({
      ...slot,
      date: "2026-07-23",
      start: "12:00",
      end: "14:00",
      note: "Prep",
    });
    const res = await asMember({
      ...slot,
      repeatWeeks: 2,
      note: "Weekly sync",
    });
    expect(res.status).toBe(201);
    const body = await made(res);
    expect(body.reservations?.map((r) => r.status)).toEqual([
      "confirmed",
      "pending",
    ]);
    expect(vi.mocked(email.sendReservationEmail).mock.calls.at(-1)?.[1]).toBe(
      "pending",
    );
  });

  it("asks for a note when any week's run reaches the limit", async () => {
    await asMember({
      ...slot,
      date: "2026-07-23",
      start: "13:00",
      end: "14:00",
    });
    const res = await asMember({ ...slot, repeatWeeks: 2 });
    expect(res.status).toBe(400);
    expect((await json(res)).field).toBe("note");
  });

  it("drops every date when the one email fails", async () => {
    vi.mocked(email.sendReservationEmail).mockResolvedValueOnce("failed");
    expect((await asMember({ ...slot, repeatWeeks: 3 })).status).toBe(502);
    expect(db.queryReservations({ filter: "all" }).total).toBe(0);
  });

  it("books a single date for a member who asks for one week, with no series", async () => {
    const body = await made(await asMember({ ...slot, repeatWeeks: 1 }));
    expect(body.reservations).toHaveLength(1);
    expect(body.reservations?.[0].seriesId).toBeUndefined();
    expect(body.seriesCancelToken).toBeUndefined();
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
    const res = await post({ ...ok, start: "14:07" });
    expect(res.status).toBe(400);
    const { error } = await json(res);
    expect(error).toContain("5-minute steps");
    expect(error).not.toContain("opening");
  });
  it("400 for an off-grid end, which the start check alone would let through", async () => {
    const res = await post({ ...ok, end: "15:07" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("5-minute steps");
  });
  // 24:00 is on the grid but is not a clock time, so the day ends a step short.
  it("400 for an end at 24:00", async () => {
    expect((await post({ ...ok, start: "23:00", end: "24:00" })).status).toBe(
      400,
    );
  });
  // 12:65 counts out to 13:05, on the grid, so only the clock check stops it.
  it("400 for a time no clock shows, even when its minutes land on the grid", async () => {
    expect((await post({ ...ok, start: "12:65" })).status).toBe(400);
    expect((await post({ ...ok, end: "14:75" })).status).toBe(400);
    expect((await post({ ...ok, start: "25:00", end: "26:00" })).status).toBe(
      400,
    );
  });
  it("400 for a time that is not HH:MM at all", async () => {
    expect((await post({ ...ok, start: "2pm" })).status).toBe(400);
    expect((await post({ ...ok, start: "" })).status).toBe(400);
    expect((await post({ ...ok, end: "15:00:00" })).status).toBe(400);
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

// The form shows the same sentences, so the route's wording is pinned whole.
describe("POST /api/reservations - the exact refusal for each slot rule", () => {
  const refusal = async (patch: Record<string, string>) => {
    const res = await post({ ...ok, ...patch });
    return [res.status, (await json(res)).error];
  };
  it("names the step, not the minimum length, for an off-grid time", async () => {
    expect(await refusal({ start: "14:07" })).toEqual([
      400,
      "Please choose times in 5-minute steps.",
    ]);
  });
  it("says the end must follow the start", async () => {
    expect(await refusal({ end: "14:00" })).toEqual([
      400,
      "The end time must be after the start time.",
    ]);
  });
  it("names the minimum length, not the step, for a short one", async () => {
    expect(await refusal({ end: "14:10" })).toEqual([
      400,
      "Reservations must be at least 15 minutes long.",
    ]);
  });
  it("says a passed time has passed", async () => {
    expect(await refusal({ start: "09:00", end: "10:00" })).toEqual([
      400,
      "That time has already passed.",
    ]);
  });
});

describe("POST /api/reservations - any hour of the day", () => {
  const TOMORROW = "2026-07-17";

  it("201 for a booking starting at midnight", async () => {
    const res = await post({
      ...ok,
      date: TOMORROW,
      start: "00:00",
      end: "01:00",
    });
    expect(res.status).toBe(201);
    const row = db.getReservation((await json(res)).reservation!.id!);
    expect(row).toMatchObject({
      startsAt: `${TOMORROW}T00:00`,
      endsAt: `${TOMORROW}T01:00`,
    });
  });

  it("201 in the early morning, before the old opening time", async () => {
    const res = await post({
      ...ok,
      date: TOMORROW,
      start: "05:30",
      end: "06:30",
    });
    expect(res.status).toBe(201);
  });

  it("201 in the late evening, after the old closing time", async () => {
    expect((await post({ ...ok, start: "21:00", end: "22:00" })).status).toBe(
      201,
    );
  });

  it("201 for a booking ending on the day's last step", async () => {
    const res = await post({ ...ok, start: "23:00", end: "23:55" });
    expect(res.status).toBe(201);
    const row = db.getReservation((await json(res)).reservation!.id!);
    expect(row?.endsAt).toBe(`${DAY}T23:55`);
  });

  it("works with OPEN_HOUR and CLOSE_HOUR unset, as the baseline leaves them", async () => {
    expect(process.env.OPEN_HOUR).toBeUndefined();
    expect(process.env.CLOSE_HOUR).toBeUndefined();
    expect((await post(ok)).status).toBe(201);
  });

  it("409 for a second booking over a midnight one, as at any other hour", async () => {
    const first = { ...ok, date: TOMORROW, start: "00:00", end: "01:00" };
    expect((await post(first)).status).toBe(201);
    const res = await post(
      {
        ...first,
        start: "00:30",
        end: "01:30",
        fullName: "Bob Builder",
        email: "bob@example.com",
      },
      "10.0.0.2",
    );
    expect(res.status).toBe(409);
  });

  it("409 for a second booking over the day's last one", async () => {
    expect((await post({ ...ok, start: "23:00", end: "23:55" })).status).toBe(
      201,
    );
    const res = await post(
      {
        ...ok,
        start: "23:30",
        end: "23:55",
        fullName: "Bob Builder",
        email: "bob@example.com",
      },
      "10.0.0.2",
    );
    expect(res.status).toBe(409);
  });
});

// No closing time: a sitting can pass midnight, so the run rule must follow.
describe("POST /api/reservations - a run across midnight", () => {
  const TOMORROW = "2026-07-17";
  // Each just under the 2-hour limit alone; together 3h50 with a 5-minute seam.
  const tonight = { ...ok, start: "22:00", end: "23:55" };
  const afterMidnight = {
    ...ok,
    date: TOMORROW,
    start: "00:00",
    end: "01:55",
  };

  it("asks for a note when the next day's booking continues tonight's", async () => {
    expect((await post(tonight)).status).toBe(201);
    const res = await post(afterMidnight);
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.field).toBe("note");
    expect(body.error).toContain("back to back");
  });

  it("asks for a note the other way round too", async () => {
    expect((await post(afterMidnight)).status).toBe(201);
    const res = await post(tonight);
    expect(res.status).toBe(400);
    expect((await json(res)).field).toBe("note");
  });

  it("holds the continued run for approval once the note is given", async () => {
    expect((await post(tonight)).status).toBe(201);
    const res = await post({ ...afterMidnight, note: "Overnight workshop" });
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("pending");
  });

  // The dead last step is not free time, so it cannot break a sitting in two.
  it("joins across a seam that no one could book either side of midnight", async () => {
    expect((await post({ ...ok, start: "21:50", end: "23:45" })).status).toBe(
      201,
    );
    const res = await post({
      ...ok,
      date: TOMORROW,
      start: "00:05",
      end: "02:00",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).field).toBe("note");
  });

  it("lets a real gap across midnight break the run", async () => {
    expect((await post({ ...ok, start: "21:00", end: "22:55" })).status).toBe(
      201,
    );
    const res = await post({
      ...ok,
      date: TOMORROW,
      start: "00:30",
      end: "02:25",
    });
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("confirmed");
  });

  it("counts a short booking bridging midnight, not just the two long ones", async () => {
    expect((await post({ ...ok, start: "22:40", end: "23:55" })).status).toBe(
      201,
    );
    expect(
      (await post({ ...ok, date: TOMORROW, start: "00:00", end: "00:15" }))
        .status,
    ).toBe(201);
    const res = await post({
      ...ok,
      date: TOMORROW,
      start: "00:15",
      end: "01:00",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).field).toBe("note");
  });

  it("leaves a next-day booking alone when it does not touch tonight's", async () => {
    expect((await post(tonight)).status).toBe(201);
    const res = await post({
      ...ok,
      date: TOMORROW,
      start: "10:00",
      end: "11:00",
    });
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("confirmed");
  });

  it("does not join another person's booking across midnight", async () => {
    expect((await post(tonight)).status).toBe(201);
    const res = await post(
      { ...afterMidnight, fullName: "Bob Builder", email: "bob@example.com" },
      "10.0.0.2",
    );
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("confirmed");
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
    const res = await post({ ...ok, end: "17:00", note: "Workshop" });
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

    // Gone, not soft-deleted: a slot held in silence is worse than no booking.
    expect(db.queryReservations({ filter: "all" }).total).toBe(0);
  });

  it("frees the slot again after a failed send", async () => {
    vi.mocked(email.sendReservationEmail).mockResolvedValueOnce("failed");
    expect((await post(ok)).status).toBe(502);
    expect((await post(ok)).status).toBe(201);
  });

  it("still books when email is switched off (no API key)", async () => {
    vi.mocked(email.sendReservationEmail).mockResolvedValueOnce("skipped");
    expect((await post(ok)).status).toBe(201);
    expect(db.queryReservations({ filter: "all" }).total).toBe(1);
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
    expect(db.queryReservations({ filter: "all" }).total).toBe(0);
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
    await post(ok);
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
    // Half-open quarter-hours do not clash, so only the throttle can reject one.
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

// The throttle keys on the IP alone, so a forgeable one means no throttle.
describe("POST /api/reservations - a forged address header cannot escape the throttle", () => {
  const SECRET = "proof-secret";
  const hhmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  beforeEach(() => vi.stubEnv("TRUSTED_PROXY_SECRET", SECRET));

  /** One booking per call, each forging a different address from one real peer. */
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
    // 20 accepted = LOGIN_IP_MAX_ATTEMPTS, each claiming a fresh address.
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
    expect((await bookAs(20, "203.0.113.2", SECRET)).status).toBe(201);
  });
});

describe("GET /api/reservations", () => {
  it("401 without an admin session", async () => {
    expect((await route.GET(makeRequest("/api/reservations"))).status).toBe(
      401,
    );
  });
  // A booker's Google session must never open the list of who booked what.
  it("401 for a member signed in with Google", async () => {
    expect(
      (
        await route.GET(
          makeRequest("/api/reservations", { token: memberToken() }),
        )
      ).status,
    ).toBe(401);
  });
  it("returns every reservation plus the stat counts for an admin", async () => {
    db.createReservation({
      boothId: "booth-1",
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T15:00`,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
    });
    db.createReservation({
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

describe("GET /api/reservations - order", () => {
  // Each request arrives an hour after the one before, for a slot out of step with it.
  const SLOTS: [name: string, start: string, status?: "pending"][] = [
    ["First", "16:00"],
    ["Second", "09:00", "pending"],
    ["Third", "13:00"],
    ["Fourth", "07:00", "pending"],
    ["Fifth", "11:00"],
  ];
  beforeEach(() => {
    for (const [hour, [fullName, start, status]] of SLOTS.entries()) {
      vi.setSystemTime(new Date(Date.UTC(2026, 6, 1, hour)));
      db.createReservation(
        {
          boothId: "booth-1",
          startsAt: `${DAY}T${start}`,
          endsAt: `${DAY}T${start.slice(0, 2)}:30`,
          fullName,
          email: `${fullName.toLowerCase()}@example.com`,
        },
        status ?? "confirmed",
      );
    }
  });

  const names = async (
    query: string,
    token: string | undefined = adminToken(),
  ) => {
    const res = await route.GET(
      makeRequest(`/api/reservations${query}`, { token }),
    );
    const body = (await res.json()) as {
      reservations?: { fullName: string }[];
    };
    return {
      status: res.status,
      names: body.reservations?.map((r) => r.fullName),
    };
  };
  const newest = ["Fifth", "Fourth", "Third", "Second", "First"];

  it("lists the newest request first, not the latest slot", async () => {
    expect(await names("")).toEqual({ status: 200, names: newest });
    expect((await names("?status=all")).names).toEqual(newest);
  });

  it("serves the view the dashboard opens on in that order", async () => {
    const opening = "?status=all&q=&page=1&pageSize=25&counts=0";
    expect((await names(opening)).names).toEqual(newest);
  });

  it("keeps that order inside a status tab", async () => {
    expect((await names("?status=pending")).names).toEqual([
      "Fourth",
      "Second",
    ]);
    expect((await names("?status=confirmed")).names).toEqual([
      "Fifth",
      "Third",
      "First",
    ]);
  });

  it("keeps that order across pages and through a search", async () => {
    expect((await names("?pageSize=2&page=1")).names).toEqual([
      "Fifth",
      "Fourth",
    ]);
    expect((await names("?pageSize=2&page=2")).names).toEqual([
      "Third",
      "Second",
    ]);
    expect((await names("?pageSize=2&page=3")).names).toEqual(["First"]);
    expect((await names("?q=f")).names).toEqual(["Fifth", "Fourth", "First"]);
  });

  it("falls back to the same order for an unknown status", async () => {
    expect((await names("?status=bogus")).names).toEqual(newest);
  });

  it("leaves a cancelled request where it was asked, and hides a deleted one", async () => {
    const all = db.queryReservations().reservations;
    const idOf = (name: string) => all.find((r) => r.fullName === name)!.id;
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 2)));
    db.updateReservationStatus(idOf("First"), "cancelled");
    db.updateReservationStatus(idOf("Third"), "deleted");

    expect((await names("")).names).toEqual([
      "Fifth",
      "Fourth",
      "Second",
      "First",
    ]);
    expect((await names("?status=deleted")).names).toEqual(["Third"]);
  });

  it("401s without an admin session and lists nothing", async () => {
    expect(await names("", "")).toEqual({ status: 401, names: undefined });
  });
});

describe("GET /api/reservations - page size", () => {
  const sizeOf = async (query: string) => {
    const res = await route.GET(
      makeRequest(`/api/reservations${query}`, { token: adminToken() }),
    );
    return ((await res.json()) as { pageSize: number }).pageSize;
  };
  it("defaults to the dashboard's page size and caps what a caller asks for", async () => {
    expect(await sizeOf("")).toBe(25);
    expect(await sizeOf("?pageSize=abc")).toBe(25);
    expect(await sizeOf("?pageSize=0")).toBe(25);
    expect(await sizeOf("?pageSize=7")).toBe(7);
    expect(await sizeOf("?pageSize=1000")).toBe(100);
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
    const r = db.createReservation({
      boothId: "booth-1",
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T15:00`,
      email: "ada@example.com",
    });
    db.updateReservationStatus(r.id, "deleted");
    const res = await del({ ids: [r.id] }, adminToken());
    expect(res.status).toBe(200);
    expect((await json(res)).removed).toBe(1);
  });
});

describe("POST /api/reservations - Turnstile", () => {
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
    expect(db.queryReservations({}).total).toBe(0);
    expect(email.sendReservationEmail).not.toHaveBeenCalled();
  });

  it("403 when Cloudflare rejects the token", async () => {
    enable();
    siteverify(false);
    const res = await post({ ...ok, turnstileToken: "bad" });
    expect(res.status).toBe(403);
    expect(db.queryReservations({}).total).toBe(0);
  });

  // Fails closed: a Cloudflare outage must not become a way in.
  it("403 when siteverify itself errors", async () => {
    enable();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // A plain stub: a tracked rejection resurfaces as an unhandled error.
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNRESET")));
    expect((await post({ ...ok, turnstileToken: "tok" })).status).toBe(403);
    expect(db.queryReservations({}).total).toBe(0);
    err.mockRestore();
  });

  it("201 when Cloudflare confirms the token", async () => {
    enable();
    siteverify(true);
    const res = await post({ ...ok, turnstileToken: "good" });
    expect(res.status).toBe(201);
    expect(db.queryReservations({}).total).toBe(1);
  });

  // Google already vouched for them, so there is no token to verify.
  it("is skipped for a member signed in with Google", async () => {
    enable();
    const res = await route.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        body: { boothId: "booth-1", date: DAY, start: "14:00", end: "15:00" },
        headers: { "x-real-ip": "10.0.0.6" },
        token: memberToken(),
      }),
    );
    expect(res.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still challenges the admin's session, which is no booker", async () => {
    enable();
    const res = await route.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        body: ok,
        headers: { "x-real-ip": "10.0.0.5" },
        token: adminToken(),
      }),
    );
    expect(res.status).toBe(403);
  });

  // Single-use, so it must not be spent on a request bound to fail.
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

  // The browser does not judge this, so the route is the only guard.
  it("does not chain onto a booking that was cancelled", async () => {
    const first = await at("14:00", "15:00");
    expect(first.status).toBe(201);
    const id = (await json(first)).reservation?.id;
    expect(id).toBeTruthy();
    db.updateReservationStatus(String(id), "cancelled");
    // Straight after the freed hour: a 400 if the dead row still counted.
    const res = await at("15:00", "16:00", { boothId: "booth-2" });
    expect(res.status).toBe(201);
    expect((await json(res)).reservation?.status).toBe("confirmed");
  });

  it("chains onto a pending neighbour, which holds its slot too", async () => {
    db.createReservation(
      {
        boothId: "booth-2",
        startsAt: `${DAY}T15:00`,
        endsAt: `${DAY}T16:00`,
        ...who,
      },
      "pending",
    );
    const res = await at("14:00", "15:00");
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("back to back");
  });

  // An unbookable gap is not a break: MIN_RESERVATION_MINUTES is the tolerance.
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
    // 60 held + 65 booked = 2h05 across a 5 minute gap, past the 2 hour limit.
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
    vi.spyOn(db, "createReservationSeries").mockImplementationOnce(() => {
      throw new Error("SQLITE_CORRUPT: database disk image is malformed");
    });
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

describe("POST /api/reservations - the Slack notice", () => {
  it("announces a booking, naming the reservation and how it was filed", async () => {
    await post(ok);
    expect(slack.postReservationToSlack).toHaveBeenCalledOnce();
    const [reservation, status] = vi.mocked(slack.postReservationToSlack).mock
      .calls[0];
    expect(reservation).toMatchObject({
      boothId: "booth-1",
      startsAt: `${DAY}T14:00`,
      endsAt: `${DAY}T15:00`,
      email: "ada@example.com",
    });
    expect(status).toBe("confirmed");
  });

  it("marks a long booking pending, which is what the channel has to act on", async () => {
    await post({ ...ok, end: "17:00", note: "Workshop" });
    expect(vi.mocked(slack.postReservationToSlack).mock.calls[0][1]).toBe(
      "pending",
    );
  });

  // An internal notice must not undo a booking already emailed and stored.
  it("still reserves the slot when Slack fails", async () => {
    vi.mocked(slack.postReservationToSlack).mockResolvedValueOnce("failed");
    const res = await post(ok);
    expect(res.status).toBe(201);
    expect((await json(res)).ok).toBe(true);
    expect(db.queryReservations().reservations).toHaveLength(1);
  });

  it("posts only after the email, so a discarded booking is never announced", async () => {
    vi.mocked(email.sendReservationEmail).mockResolvedValueOnce("failed");
    const res = await post(ok);
    expect(res.status).toBe(502);
    expect(slack.postReservationToSlack).not.toHaveBeenCalled();
  });

  it("says nothing when the booking was refused outright", async () => {
    await post({ ...ok, fullName: "  " });
    expect(slack.postReservationToSlack).not.toHaveBeenCalled();
  });
});

describe("POST /api/reservations - what reaches the Slack channel", () => {
  const HOOK = "https://hooks.slack.com/services/T0/B0/secret";
  const fetchMock = vi.fn();

  // The real builder runs here, so this pins what actually leaves the server.
  beforeEach(async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", HOOK);
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const real = await vi.importActual<Slack>("@/lib/slack");
    vi.mocked(slack.postReservationToSlack).mockImplementation(
      real.postReservationToSlack,
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("names the booker but never posts their email", async () => {
    expect((await post(ok)).status).toBe(201);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(HOOK);
    const sent = fetchMock.mock.calls[0][1].body as string;
    expect(sent).toContain("Ada Lovelace");
    expect(sent).not.toContain("ada@example.com");
  });

  it("keeps the email out of a pending request too", async () => {
    await post({ ...ok, end: "17:00", note: "Workshop" });
    const sent = fetchMock.mock.calls[0][1].body as string;
    expect(sent).toContain("Awaiting approval");
    expect(sent).not.toContain("ada@example.com");
  });
});

describe("a write whose body is not an object", () => {
  const bodies = [
    ["a literal null", "null"],
    ["a list", "[1, 2]"],
    ["a number", "5"],
    ["a bare string", '"x"'],
  ] as const;

  it.each(bodies)(
    "POST refuses %s as an empty form",
    async (_name, rawBody) => {
      const res = await route.POST(
        makeRequest("/api/reservations", {
          method: "POST",
          rawBody,
          headers: { "x-real-ip": "10.0.0.9" },
        }),
      );
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({
        ok: false,
        error: "Please enter your full name.",
        field: "fullName",
      });
    },
  );

  it.each(bodies)(
    "DELETE refuses %s and removes nothing",
    async (_name, rawBody) => {
      const res = await route.DELETE(
        makeRequest("/api/reservations", {
          method: "DELETE",
          rawBody,
          token: adminToken(),
        }),
      );
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({
        ok: false,
        error: "Expected { ids: string[] }.",
      });
    },
  );
});
