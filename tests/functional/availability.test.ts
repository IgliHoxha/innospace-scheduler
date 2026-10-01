import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { todayYMD } from "@/lib/datetime";

type Route = typeof import("@/app/api/availability/route");
type Db = typeof import("@/lib/db");
let route: Route;
let db: Db;

const today = todayYMD();

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/availability/route");
});

function get(query: string) {
  return route.GET(makeRequest(`/api/availability?${query}`));
}

async function seatOne(fullName: string) {
  db.createReservation({
    boothId: "booth-1",
    startsAt: `${today}T14:00`,
    endsAt: `${today}T15:00`,
    fullName,
    email: `${fullName.toLowerCase()}@example.com`,
  });
}

describe("GET /api/availability", () => {
  it("is public: no session needed, since the booking screen is", async () => {
    expect((await get(`booth=booth-1&date=${today}`)).status).toBe(200);
  });

  it("400 for an unknown booth", async () => {
    const res = await get("booth=nope&date=" + today);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown booth.");
  });

  it("400 for a date outside the reservation window", async () => {
    expect((await get("booth=booth-1&date=1999-01-01")).status).toBe(400);
  });

  it("400 when either query param is missing entirely", async () => {
    expect((await get(`date=${today}`)).status).toBe(400);
    expect((await get("booth=booth-1")).status).toBe(400);
    expect((await get("")).status).toBe(400);
  });

  it("returns reserved ranges, and no opening hours since there are none", async () => {
    await seatOne("Ada");
    const res = await get(`booth=booth-1&date=${today}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      booth: "booth-1",
      date: today,
    });
    expect(body).not.toHaveProperty("opens");
    expect(body).not.toHaveProperty("closes");
    expect(body.reserved).toHaveLength(1);
    expect(body.reserved[0]).toMatchObject({
      start: "14:00",
      end: "15:00",
      label: "14:00 - 15:00",
    });
  });

  // The board is CDN-cached, so a reload busts it with `t`; the route must not mind.
  it("ignores the cache-busting param, answering exactly as it would without it", async () => {
    await seatOne("Ada");
    const plain = await (await get(`booth=booth-1&date=${today}`)).json();
    const busted = await (
      await get(`booth=booth-1&date=${today}&t=1700000000`)
    ).json();
    expect(busted).toEqual(plain);
    expect(busted.ok).toBe(true);
  });

  it("ignores any other unknown query param too", async () => {
    const res = await get(`booth=booth-1&date=${today}&utm_source=x&t=`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("exposes times only: never a name, email, note or id", async () => {
    db.createReservation({
      boothId: "booth-1",
      startsAt: `${today}T14:00`,
      endsAt: `${today}T15:00`,
      fullName: "Ada",
      email: "ada@example.com",
      note: "Board meeting",
    });
    const body = await (await get(`booth=booth-1&date=${today}`)).json();
    // The board is public, so a slot may say it is taken and nothing more.
    expect(Object.keys(body.reserved[0]).sort()).toEqual([
      "end",
      "label",
      "start",
    ]);
    expect(JSON.stringify(body)).not.toContain("Ada");
  });
});

describe("GET /api/availability counts", () => {
  // A pinned clock: the real date would move under a run that straddles midnight.
  const DAY = "2026-07-16";
  const NEXT = "2026-07-17";
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T12:00:00`));
  });
  afterEach(() => vi.useRealTimers());

  const book = (boothId: string, start: string, end: string, who: string) =>
    db.createReservation({
      boothId,
      startsAt: `${DAY}T${start}`,
      endsAt: `${DAY}T${end}`,
      fullName: who,
      email: `${who.toLowerCase()}@example.com`,
    });

  it("lists every configured booth at zero on an empty day", async () => {
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.counts).toEqual({ "booth-1": 0, "booth-2": 0, "booth-3": 0 });
  });

  it("counts every booth, not only the one the board is for", async () => {
    book("booth-1", "09:00", "10:00", "Ada");
    book("booth-1", "11:00", "12:00", "Bob");
    book("booth-3", "09:00", "10:00", "Cy");
    const body = await (await get(`booth=booth-2&date=${DAY}`)).json();
    expect(body.counts).toEqual({ "booth-1": 2, "booth-2": 0, "booth-3": 1 });
    expect(body.reserved).toEqual([]);
  });

  it("gives the same counts whichever booth is asked for", async () => {
    book("booth-1", "09:00", "10:00", "Ada");
    book("booth-2", "09:00", "10:00", "Bob");
    const one = await (await get(`booth=booth-1&date=${DAY}`)).json();
    const two = await (await get(`booth=booth-2&date=${DAY}`)).json();
    expect(one.counts).toEqual(two.counts);
  });

  it("matches the board's own length for the booth asked for", async () => {
    book("booth-1", "09:00", "10:00", "Ada");
    book("booth-1", "14:00", "15:00", "Bob");
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.counts["booth-1"]).toBe(body.reserved.length);
  });

  // No opening hours: the board and the count must both reach the day's two ends.
  it("lists and counts the first and last bookings a day can hold", async () => {
    book("booth-1", "23:40", "23:55", "Ada");
    book("booth-1", "00:00", "01:00", "Bob");
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.reserved.map((r: { label: string }) => r.label)).toEqual([
      "00:00 - 01:00",
      "23:40 - 23:55",
    ]);
    expect(body.counts["booth-1"]).toBe(2);
  });

  it("counts a pending request and drops a cancelled one", async () => {
    const cancelled = book("booth-1", "09:00", "10:00", "Ada");
    db.createReservation(
      {
        boothId: "booth-1",
        startsAt: `${DAY}T14:00`,
        endsAt: `${DAY}T15:00`,
      },
      "pending",
    );
    db.updateReservationStatus(cancelled.id, "cancelled");
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.counts["booth-1"]).toBe(1);
  });

  it("counts the day asked for, not another one", async () => {
    book("booth-1", "09:00", "10:00", "Ada");
    const body = await (await get(`booth=booth-1&date=${NEXT}`)).json();
    expect(body.counts["booth-1"]).toBe(0);
  });

  // A late booking today and an early one tomorrow sit five minutes apart.
  it("does not let a booking just past midnight count towards the day before", async () => {
    book("booth-1", "23:40", "23:55", "Ada");
    db.createReservation({
      boothId: "booth-1",
      startsAt: `${NEXT}T00:00`,
      endsAt: `${NEXT}T01:00`,
      fullName: "Bob",
      email: "bob@example.com",
    });
    const today = await (await get(`booth=booth-1&date=${DAY}`)).json();
    const next = await (await get(`booth=booth-1&date=${NEXT}`)).json();
    expect(today.counts["booth-1"]).toBe(1);
    expect(next.counts["booth-1"]).toBe(1);
  });

  // A booth dropped from SCHEDULER_BOOTHS keeps its rows, which no card can show.
  it("does not leak a booth that is no longer configured", async () => {
    book("booth-retired", "09:00", "10:00", "Ada");
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(Object.keys(body.counts).sort()).toEqual([
      "booth-1",
      "booth-2",
      "booth-3",
    ]);
  });

  it("carries numbers only: no name, email or note rides along", async () => {
    db.createReservation({
      boothId: "booth-2",
      startsAt: `${DAY}T09:00`,
      endsAt: `${DAY}T10:00`,
      fullName: "Grace",
      email: "grace@example.com",
      note: "Quarterly review",
    });
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(Object.values(body.counts).every((n) => typeof n === "number")).toBe(
      true,
    );
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("Grace");
    expect(raw).not.toContain("Quarterly");
  });
});

describe("GET /api/availability earliest (today only)", () => {
  const DAY = "2026-07-16";
  afterEach(() => vi.useRealTimers());

  it("clamps earliest to now once the day is underway", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T10:30:00`));
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.earliest).toBe("10:30");
  });

  // Regression: seeding from earliest once produced an off-grid, refused start.
  it("rounds earliest up onto the step grid", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T15:22:00`));
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.earliest).toBe("15:25");
  });

  it("carries the rounding over the hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T15:58:30`));
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.earliest).toBe("16:00");
  });

  // No opening time holds it back: early morning is as bookable as any hour.
  it("follows the clock in the early morning too", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T07:00:00`));
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.earliest).toBe("07:00");
  });

  it("is midnight at the very start of the day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T00:00:00`));
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.earliest).toBe("00:00");
  });

  // Past the last step nothing is left, which the form reads as the day being over.
  it("runs off the end of the day in its final minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T23:57:00`));
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.earliest).toBe("24:00");
  });

  it("opens any other day at midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T15:22:00`));
    const body = await (await get("booth=booth-1&date=2026-07-17")).json();
    expect(body.earliest).toBe("00:00");
  });
});

// The block above pins a fixed DAY, so only the "other day" path ran.
describe("GET /api/availability earliest (the request is for today)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("follows the clock before what used to be opening time", async () => {
    vi.setSystemTime(new Date(`${today}T06:00:00`));
    const body = await (await get(`booth=booth-1&date=${today}`)).json();
    expect(body.earliest).toBe("06:00");
  });

  it("moves past now once the day is underway", async () => {
    vi.setSystemTime(new Date(`${today}T13:07:00`));
    const body = await (await get(`booth=booth-1&date=${today}`)).json();
    expect(body.earliest).toBe("13:10"); // rounded up onto the 5-minute grid
  });
});
