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

  it("returns reserved ranges, opening hours, and who holds each slot", async () => {
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
      by: "Ada",
    });
  });

  it("exposes the name only: never the email, note or id", async () => {
    await db.createReservation({
      boothId: "booth-1",
      startsAt: `${today}T14:00`,
      endsAt: `${today}T15:00`,
      fullName: "Ada",
      email: "ada@example.com",
      note: "Board meeting",
    });
    const body = await (await get(`booth=booth-1&date=${today}`)).json();
    expect(Object.keys(body.reserved[0]).sort()).toEqual([
      "by",
      "end",
      "label",
      "start",
    ]);
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
