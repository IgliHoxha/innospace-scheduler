import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp, userToken } from "../helpers/app";
import { todayYMD } from "@/lib/date-format";

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

function get(query: string, tok?: string) {
  return route.GET(makeRequest(`/api/availability?${query}`, { token: tok }));
}

async function seatOne(userId: string, fullName: string) {
  await db.createReservation({
    boothId: "booth-1",
    startsAt: `${today}T14:00`,
    endsAt: `${today}T15:00`,
    userId,
    fullName,
  });
}

describe("GET /api/availability", () => {
  it("401 without a session", async () => {
    expect((await get(`booth=booth-1&date=${today}`)).status).toBe(401);
  });

  it("400 for an unknown booth", async () => {
    const res = await get("booth=nope&date=" + today, userToken("u1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Unknown booth.");
  });

  it("400 for a date outside the reservation window", async () => {
    expect(
      (await get("booth=booth-1&date=1999-01-01", userToken("u1"))).status,
    ).toBe(400);
  });

  it("returns reserved ranges, opening hours, and a mine flag", async () => {
    await seatOne("u1", "Ada");
    const res = await get(`booth=booth-1&date=${today}`, userToken("u1"));
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
      mine: true,
    });
  });

  it("marks another member's reservation as not mine", async () => {
    await seatOne("u2", "Bob");
    const body = await (
      await get(`booth=booth-1&date=${today}`, userToken("u1"))
    ).json();
    expect(body.reserved[0]).toMatchObject({ by: "Bob", mine: false });
  });
});

describe("GET /api/availability earliest (today only)", () => {
  const DAY = "2026-07-16";
  afterEach(() => vi.useRealTimers());

  it("clamps earliest to now once the day is underway", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T10:30:00`));
    const body = await (
      await get(`booth=booth-1&date=${DAY}`, userToken("u1"))
    ).json();
    expect(body.earliest).toBe("10:30");
  });

  it("stays at opening time before the space opens", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T07:00:00`));
    const body = await (
      await get(`booth=booth-1&date=${DAY}`, userToken("u1"))
    ).json();
    expect(body.earliest).toBe("09:00");
  });
});
