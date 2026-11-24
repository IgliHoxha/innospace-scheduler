import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminToken,
  insertReservation,
  memberToken,
  resetApp,
} from "../helpers/app";
import { SESSION_COOKIE } from "@/lib/auth";
import type { MyBookingsPage } from "@/lib/my-bookings";

let cookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && cookie ? { value: cookie } : undefined,
  }),
}));
// Next's redirect throws to stop rendering, so the stand-in does too.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

type Page = typeof import("@/app/bookings/page");
type Db = typeof import("@/lib/db");
let page: Page;
let db: Db;

const D = "2026-07-16";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${D}T12:00:00`));
  cookie = undefined;
  resetApp();
  db = await import("@/lib/db");
  page = await import("@/app/bookings/page");
});

const render = (search: { page?: string } = {}) =>
  page.default({ searchParams: Promise.resolve(search) }) as Promise<{
    props: { name: string; email: string; initial: MyBookingsPage };
  }>;

describe("the /bookings page", () => {
  it("renders the member's first page from the server, named from the session", async () => {
    cookie = memberToken("Ada Lovelace", "ada@example.com");
    const r = insertReservation(db, {
      boothId: "booth-1",
      startsAt: `${D}T15:00`,
      endsAt: `${D}T16:00`,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
    });
    const { props } = await render();
    expect(props.name).toBe("Ada Lovelace");
    expect(props.email).toBe("ada@example.com");
    expect(props.initial).toMatchObject({ page: 1, total: 1, pageSize: 10 });
    expect(props.initial.bookings.map((b) => b.id)).toEqual([r.id]);
  });

  it("opens on the page in the address, clamped to the last", async () => {
    cookie = memberToken("Ada Lovelace", "ada@example.com");
    for (let h = 0; h < 11; h++) {
      insertReservation(db, {
        boothId: "booth-1",
        startsAt: `${D}T${String(h).padStart(2, "0")}:00`,
        endsAt: `${D}T${String(h).padStart(2, "0")}:30`,
        email: "ada@example.com",
      });
    }
    expect((await render({ page: "2" })).props.initial.page).toBe(2);
    expect((await render({ page: "7" })).props.initial.page).toBe(2);
  });

  it("sends a guest and the admin back to the booking screen", async () => {
    await expect(render()).rejects.toThrow("redirect:/");
    cookie = adminToken();
    await expect(render()).rejects.toThrow("redirect:/");
    cookie = "forged.token";
    await expect(render()).rejects.toThrow("redirect:/");
  });
});
