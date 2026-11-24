// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MyBookingsClient from "@/app/bookings/MyBookingsClient";
import { formatDateTime } from "@/lib/datetime";
import type { MyBooking, MyBookingsPage } from "@/lib/my-bookings";

vi.mock("@/components/SiteFooter", () => ({ SiteFooter: () => null }));

const D = "2026-07-16";
const at = (t: string) => `${D}T${t}`;
const BOOKED = "2026-07-10T08:00:00.000Z";

const booking = (over: Partial<MyBooking>): MyBooking => ({
  id: "r1",
  boothName: "Booth 1",
  startsAt: at("15:00"),
  endsAt: at("16:00"),
  status: "confirmed",
  phase: "upcoming",
  createdAt: BOOKED,
  ...over,
});

const pageOf = (
  bookings: MyBooking[],
  over: Partial<MyBookingsPage> = {},
): MyBookingsPage => ({
  now: at("12:02"),
  stepMinutes: 5,
  minMinutes: 15,
  page: 1,
  pageSize: 10,
  total: bookings.length,
  bookings,
  ...over,
});

type Reply = { status: number; body: Record<string, unknown> };

/** What the server answers for each page number. */
let pages: Map<number, MyBookingsPage>;
let calls: { url: string; method: string; body?: unknown }[];
let replies: (Reply | "drop")[];
let listFails: boolean;
let addresses: string[];

beforeEach(() => {
  pages = new Map();
  calls = [];
  replies = [];
  listFails = false;
  addresses = [];
  vi.spyOn(window.history, "replaceState").mockImplementation(
    (_s, _t, url) => void addresses.push(String(url)),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const json = (r: Reply) => ({
        ok: r.status < 300,
        status: r.status,
        json: async () => r.body,
      });
      if (method === "GET") {
        if (listFails) throw new TypeError("Failed to fetch");
        const n = Number(new URL(url, "http://x").searchParams.get("page"));
        return json({
          status: 200,
          body: { ok: true, ...(pages.get(n) ?? pageOf([])) },
        });
      }
      const next = replies.shift() ?? { status: 200, body: { ok: true } };
      if (next === "drop") throw new TypeError("Failed to fetch");
      return json(next);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(initial: MyBookingsPage) {
  // The server's answer for a reload of the page on screen, unless a test says otherwise.
  if (!pages.has(initial.page)) pages.set(initial.page, initial);
  const user = userEvent.setup();
  render(
    <MyBookingsClient
      name="Ada Lovelace"
      email="ada@example.com"
      initial={initial}
    />,
  );
  return { user };
}

const row = (booth: string) =>
  screen.getByText(booth, { selector: "strong" }).closest("li") as HTMLElement;
const facts = (li: HTMLElement) =>
  [...li.querySelectorAll("dt")].map((dt) => [
    dt.textContent,
    dt.nextElementSibling?.textContent,
  ]);
const groups = () =>
  [...document.querySelectorAll(".my-bookings-group h2")].map(
    (h) => h.textContent,
  );
const writes = () => calls.filter((c) => c.method !== "GET");
const reads = () => calls.filter((c) => c.method === "GET").map((c) => c.url);

describe("the my bookings page", () => {
  it("is a page of its own, headed and signed in, with the list already there", () => {
    mount(pageOf([booking({})]));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "My bookings",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "‹ Reserve a booth" })
        .getAttribute("href"),
    ).toBe("/");
    expect(groups()).toEqual(["Upcoming"]);
    // Rendered by the server, so nothing is fetched to show the first page.
    expect(calls).toEqual([]);
  });

  it("groups the bookings on a page: in progress, upcoming, past", () => {
    mount(
      pageOf([
        booking({
          id: "a",
          boothName: "Booth 1",
          phase: "ongoing",
          startsAt: at("11:30"),
          endsAt: at("12:30"),
        }),
        booking({ id: "b", boothName: "Booth 2", phase: "upcoming" }),
        booking({
          id: "c",
          boothName: "Booth 3",
          phase: "past",
          startsAt: at("08:00"),
          endsAt: at("09:00"),
        }),
      ]),
    );
    expect(groups()).toEqual(["In progress", "Upcoming", "Past"]);
    expect(
      within(row("Booth 1")).getByRole("button", { name: "Save" }),
    ).toBeTruthy();
    // Under way, it can still be dropped: the rest of its time frees up.
    expect(
      within(row("Booth 1")).getByRole("button", { name: "Cancel" }),
    ).toBeTruthy();
    expect(
      within(row("Booth 2")).getByRole("button", { name: "Cancel" }),
    ).toBeTruthy();
    expect(within(row("Booth 3")).queryAllByRole("button")).toEqual([]);
  });

  it("shows each booking's date, scheduled times, when it was booked and its note", () => {
    mount(
      pageOf([
        booking({ note: "Client call\nwith the team" }),
        booking({ id: "r2", boothName: "Booth 2" }),
      ]),
    );
    expect(facts(row("Booth 1"))).toEqual([
      ["Date", "Thursday, 16 July 2026"],
      ["Time", "15:00 - 16:00"],
      ["Booked on", formatDateTime(BOOKED)],
      ["Note", "Client call\nwith the team"],
    ]);
    expect(facts(row("Booth 2")).map(([k]) => k)).toEqual([
      "Date",
      "Time",
      "Booked on",
    ]);
  });

  // React escapes text, so a booker's markup is shown, never run.
  it("shows a note holding markup as plain text, running nothing", () => {
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    const note = "<script>alert('aaa')</script><img src=x onerror=alert(1)>";
    mount(pageOf([booking({ note })]));
    const shown = row("Booth 1").querySelector(".my-booking-note")!;
    expect(shown.textContent).toBe(note);
    expect(shown.children).toHaveLength(0);
    expect(
      document.querySelector(".my-bookings script, .my-bookings img"),
    ).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it("marks a pending request and a cancelled booking, and offers nothing on the cancelled one", () => {
    mount(
      pageOf([
        booking({ status: "pending" }),
        booking({ id: "r2", boothName: "Booth 2", status: "cancelled" }),
      ]),
    );
    expect(row("Booth 1").querySelector(".badge")?.textContent).toBe(
      "Awaiting approval",
    );
    expect(row("Booth 2").querySelector(".badge")?.textContent).toBe(
      "Cancelled",
    );
    expect(within(row("Booth 2")).queryAllByRole("button")).toEqual([]);
  });

  it("points a member with no bookings at the booking screen", () => {
    mount(pageOf([]));
    expect(document.querySelector(".empty")?.textContent).toContain(
      "You have no bookings yet.",
    );
    expect(document.querySelector(".pagination")).toBeNull();
  });
});

describe("turning pages", () => {
  const many = (page: number, n: number) =>
    Array.from({ length: n }, (_, i) =>
      booking({
        id: `p${page}-${i}`,
        boothName: `Booth ${page}-${i}`,
        phase: "past",
      }),
    );

  it("says where in the list it is, and offers the pages", () => {
    mount(pageOf(many(1, 10), { total: 23 }));
    expect(document.querySelector(".pagination-info")?.textContent).toBe(
      "1-10 of 23",
    );
    expect(
      [...document.querySelectorAll(".pagination-controls .page-btn")].map(
        (b) => b.textContent,
      ),
    ).toEqual(["‹ Prev", "1", "2", "3", "Next ›"]);
  });

  it("fetches the page asked for and puts it in the address", async () => {
    pages.set(2, pageOf(many(2, 10), { page: 2, total: 23 }));
    const { user } = mount(pageOf(many(1, 10), { total: 23 }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByText("Booth 2-0")).toBeTruthy());
    expect(screen.queryByText("Booth 1-0")).toBeNull();
    expect(reads()).toEqual(["/api/me/reservations?page=2"]);
    expect(addresses).toEqual(["/bookings?page=2"]);
    expect(document.querySelector(".pagination-info")?.textContent).toBe(
      "11-20 of 23",
    );
    expect(
      screen.getByRole("button", { name: "2" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("drops the page from the address on the first one", async () => {
    pages.set(1, pageOf(many(1, 10), { total: 23 }));
    const { user } = mount(pageOf(many(2, 10), { page: 2, total: 23 }));
    await user.click(screen.getByRole("button", { name: "1" }));
    await waitFor(() => expect(addresses).toEqual(["/bookings"]));
  });

  it("keeps the page on screen and offers a retry when a page fails to load", async () => {
    pages.set(2, pageOf(many(2, 10), { page: 2, total: 23 }));
    listFails = true;
    const { user } = mount(pageOf(many(1, 10), { total: 23 }));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText("Booth 1-0")).toBeTruthy();
    listFails = false;
    await user.click(retry);
    // The retry reloads the page on screen; the reader can turn again from there.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull(),
    );
    expect(reads().at(-1)).toBe("/api/me/reservations?page=1");
  });
});

describe("cancelling an upcoming booking", () => {
  it("asks first, then cancels and reloads the page it is on", async () => {
    const { user } = mount(pageOf([booking({})], { page: 2, total: 11 }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(row("Booth 1").textContent).toContain("Cancel this booking?");
    expect(writes()).toEqual([]);

    pages.set(
      2,
      pageOf([booking({ status: "cancelled" })], { page: 2, total: 11 }),
    );
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() =>
      expect(row("Booth 1").querySelector(".badge")?.textContent).toBe(
        "Cancelled",
      ),
    );
    expect(writes()).toEqual([
      { url: "/api/me/reservations/r1", method: "DELETE", body: undefined },
    ]);
    expect(reads()).toEqual(["/api/me/reservations?page=2"]);
  });

  it("cancels a booking under way the same way, below its end time", async () => {
    const ongoing = booking({
      phase: "ongoing",
      startsAt: at("11:30"),
      endsAt: at("12:30"),
    });
    const { user } = mount(pageOf([ongoing]));
    const li = row("Booth 1");
    // The end editor first, then the way to drop it.
    const actions = [...li.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(actions).toEqual(["Save", "Cancel"]);
    await user.click(within(li).getByRole("button", { name: "Cancel" }));
    pages.set(1, pageOf([{ ...ongoing, status: "cancelled" }]));
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() =>
      expect(row("Booth 1").querySelector(".badge")?.textContent).toBe(
        "Cancelled",
      ),
    );
    expect(writes()).toEqual([
      { url: "/api/me/reservations/r1", method: "DELETE", body: undefined },
    ]);
    // Cancelled, it is no longer under way: nothing left to edit.
    expect(within(row("Booth 1")).queryAllByRole("button")).toEqual([]);
  });

  it("keeps the booking on 'Keep it'", async () => {
    const { user } = mount(pageOf([booking({})]));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(writes()).toEqual([]);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("shows the server's refusal on the row and reloads nothing", async () => {
    replies.push({
      status: 400,
      body: {
        ok: false,
        error: "A booking that is already over can't be cancelled.",
      },
    });
    const { user } = mount(pageOf([booking({})]));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));
    expect((await within(row("Booth 1")).findByRole("alert")).textContent).toBe(
      "A booking that is already over can't be cancelled.",
    );
    expect(reads()).toEqual([]);
  });

  it("says so when the server cannot be reached", async () => {
    replies.push("drop");
    const { user } = mount(pageOf([booking({})]));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not reach the server. Please try again.",
    );
  });
});

describe("moving the end of a booking under way", () => {
  const ongoing = () =>
    booking({ phase: "ongoing", startsAt: at("11:30"), endsAt: at("12:30") });
  const field = (part: "hours" | "minutes") =>
    document.getElementById(`end-r1-${part}`) as HTMLInputElement;
  const save = () =>
    screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;

  it("opens on the current end with Save off until it changes", () => {
    mount(pageOf([ongoing()]));
    // In the scope that gives the fields a solid border, and the small size.
    expect(field("hours").closest(".tp-scope.my-booking-end")).not.toBeNull();
    expect([field("hours").value, field("minutes").value]).toEqual([
      "12",
      "30",
    ]);
    expect(save().disabled).toBe(true);
  });

  it("sends the new end and reseeds from the saved booking", async () => {
    const { user } = mount(pageOf([ongoing()]));
    await user.click(field("hours"));
    await user.keyboard("{ArrowUp}");
    expect(save().disabled).toBe(false);

    pages.set(1, pageOf([{ ...ongoing(), endsAt: at("13:30") }]));
    await user.click(save());
    await waitFor(() =>
      expect(row("Booth 1").textContent).toContain("11:30 - 13:30"),
    );
    expect(writes()).toEqual([
      {
        url: "/api/me/reservations/r1",
        method: "PATCH",
        body: { end: "13:30" },
      },
    ]);
    expect(save().disabled).toBe(true);
  });

  it("will not send an end at or before now, naming the earliest it takes", async () => {
    const { user } = mount(pageOf([ongoing()]));
    await user.click(field("minutes"));
    await user.keyboard("00");
    expect(save().disabled).toBe(true);
    expect(within(row("Booth 1")).getByRole("alert").textContent).toBe(
      "Pick 12:05 or later.",
    );
  });

  it("will not send an end off the grid", async () => {
    const { user } = mount(pageOf([ongoing()]));
    await user.click(field("minutes"));
    await user.keyboard("33");
    expect(save().disabled).toBe(true);
    expect(within(row("Booth 1")).getByRole("alert").textContent).toBe(
      "Please choose times in 5-minute steps.",
    );
  });

  it("shows a clash the server reports, keeping the typed end", async () => {
    replies.push({
      status: 409,
      body: { ok: false, error: "That time slot is no longer available." },
    });
    const { user } = mount(pageOf([ongoing()]));
    await user.click(field("hours"));
    await user.keyboard("{ArrowUp}");
    await user.click(save());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That time slot is no longer available.",
    );
    expect(field("hours").value).toBe("13");
    expect(reads()).toEqual([]);
  });
});
