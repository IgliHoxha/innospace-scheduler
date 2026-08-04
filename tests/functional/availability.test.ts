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
  await db.createReservation({
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

  it("returns reserved ranges and opening hours", async () => {
    await seatOne("Ada");
    const res = await get(`booth=booth-1&date=${today}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      booth: "booth-1",
      date: today,
      opens: "09:00",
      closes: "18:00",
    });
    expect(body.reserved).toHaveLength(1);
    expect(body.reserved[0]).toMatchObject({
      start: "14:00",
      end: "15:00",
      label: "14:00 - 15:00",
    });
  });

  // The board is CDN-cached, so a post-booking reload busts it with `t`; the route must not mind.
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
    await db.createReservation({
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

describe("GET /api/availability earliest (today only)", () => {
  const DAY = "2026-07-16";
  afterEach(() => vi.useRealTimers());

  it("clamps earliest to now once the day is underway", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T10:30:00`));
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.earliest).toBe("10:30");
  });

  // Regression: the picker seeds from earliest, so an off-grid value produced a start the API refused.
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

  it("stays at opening time before the space opens", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T07:00:00`));
    const body = await (await get(`booth=booth-1&date=${DAY}`)).json();
    expect(body.earliest).toBe("09:00");
  });
});

// The block above pins a fixed DAY, which is never today, so only the "other day" path ran.
describe("GET /api/availability earliest (the request is for today)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("keeps opening time when now is still before the space opens", async () => {
    vi.setSystemTime(new Date(`${today}T06:00:00`));
    const body = await (await get(`booth=booth-1&date=${today}`)).json();
    expect(body.earliest).toBe(body.opens);
  });

  it("moves past now once the day is underway", async () => {
    vi.setSystemTime(new Date(`${today}T13:07:00`));
    const body = await (await get(`booth=booth-1&date=${today}`)).json();
    expect(body.earliest).toBe("13:10"); // rounded up onto the 5-minute grid
  });
});
