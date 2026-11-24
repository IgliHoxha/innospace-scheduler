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
import { MyBookings } from "@/app/_booking/MyBookings";
import { formatDateTime } from "@/lib/datetime";
import type { MyBooking } from "@/lib/my-bookings";

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

type Reply = { status: number; body: Record<string, unknown> };

let bookings: MyBooking[];
let calls: { url: string; method: string; body?: unknown }[];
let replies: (Reply | "drop")[];
let listFails: boolean;

beforeEach(() => {
  bookings = [];
  calls = [];
  replies = [];
  listFails = false;
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
        return json({
          status: 200,
          body: {
            ok: true,
            now: at("12:02"),
            stepMinutes: 5,
            minMinutes: 15,
            bookings,
          },
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
  vi.unstubAllGlobals();
});

function mount() {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const user = userEvent.setup();
  render(<MyBookings onClose={onClose} onChanged={onChanged} />);
  return { user, onClose, onChanged };
}

const row = (booth: string) =>
  screen.getByText(booth).closest("li") as HTMLElement;
const facts = (li: HTMLElement) =>
  [...li.querySelectorAll("dt")].map((dt) => [
    dt.textContent,
    dt.nextElementSibling?.textContent,
  ]);
const groups = () =>
  [...document.querySelectorAll(".my-bookings-group h3")].map(
    (h) => h.textContent,
  );
const writes = () => calls.filter((c) => c.method !== "GET");

describe("the my bookings dialog", () => {
  it("opens as a labelled dialog with focus on its close button", async () => {
    mount();
    const dialog = screen.getByRole("dialog", { name: "My bookings" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Close" }),
    );
    expect(dialog.textContent).toContain("Loading your bookings");
    await waitFor(() => expect(dialog.textContent).toContain("no bookings"));
    expect(calls[0].url).toBe("/api/me/reservations");
  });

  it("groups the bookings: in progress, upcoming, past", async () => {
    bookings = [
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
    ];
    mount();
    await waitFor(() =>
      expect(groups()).toEqual(["In progress", "Upcoming", "Past"]),
    );
    expect(
      within(row("Booth 1")).getByRole("button", { name: "Save" }),
    ).toBeTruthy();
    expect(
      within(row("Booth 2")).getByRole("button", { name: "Cancel" }),
    ).toBeTruthy();
    expect(within(row("Booth 3")).queryAllByRole("button")).toEqual([]);
  });

  it("shows each booking's date, scheduled times, when it was booked and its note", async () => {
    bookings = [
      booking({ note: "Client call\nwith the team" }),
      booking({ id: "r2", boothName: "Booth 2" }),
    ];
    mount();
    await waitFor(() => expect(groups()).toEqual(["Upcoming"]));
    expect(facts(row("Booth 1"))).toEqual([
      ["Date", "Thursday, 16 July 2026"],
      ["Time", "15:00 - 16:00"],
      ["Booked on", formatDateTime(BOOKED)],
      ["Note", "Client call\nwith the team"],
    ]);
    // No note, no empty line for one.
    expect(facts(row("Booth 2")).map(([k]) => k)).toEqual([
      "Date",
      "Time",
      "Booked on",
    ]);
  });

  // React escapes text, so a booker's markup is shown, never run.
  it("shows a note holding markup as plain text, running nothing", async () => {
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    const note = "<script>alert('aaa')</script><img src=x onerror=alert(1)>";
    bookings = [booking({ note })];
    mount();
    await waitFor(() => expect(groups()).toEqual(["Upcoming"]));
    const shown = row("Booth 1").querySelector(".my-booking-note")!;
    expect(shown.textContent).toBe(note);
    expect(shown.children).toHaveLength(0);
    expect(document.querySelector("script, img")).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it("marks a pending request and a cancelled booking, and offers nothing on the cancelled one", async () => {
    bookings = [
      booking({ status: "pending" }),
      booking({ id: "r2", boothName: "Booth 2", status: "cancelled" }),
    ];
    mount();
    await waitFor(() => expect(groups()).toEqual(["Upcoming"]));
    expect(row("Booth 1").querySelector(".badge")?.textContent).toBe(
      "Awaiting approval",
    );
    expect(row("Booth 2").querySelector(".badge")?.textContent).toBe(
      "Cancelled",
    );
    expect(within(row("Booth 2")).queryAllByRole("button")).toEqual([]);
  });

  it("offers a retry when the list fails to load", async () => {
    listFails = true;
    const { user } = mount();
    const retry = await screen.findByRole("button", { name: "Try again" });
    listFails = false;
    bookings = [booking({})];
    await user.click(retry);
    await waitFor(() => expect(groups()).toEqual(["Upcoming"]));
  });

  it("closes on the close button, Escape and a click outside, never from inside", async () => {
    const { user, onClose } = mount();
    await user.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.keyboard("{Escape}");
    await user.click(document.querySelector(".modal-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("cancelling an upcoming booking", () => {
  it("asks first, then cancels, tells the page and reloads the list", async () => {
    bookings = [booking({})];
    const { user, onChanged } = mount();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(row("Booth 1").textContent).toContain("Cancel this booking?");
    expect(writes()).toEqual([]);

    bookings = [booking({ status: "cancelled" })];
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() =>
      expect(row("Booth 1").querySelector(".badge")?.textContent).toBe(
        "Cancelled",
      ),
    );
    expect(writes()).toEqual([
      { url: "/api/me/reservations/r1", method: "DELETE", body: undefined },
    ]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps the booking on 'Keep it'", async () => {
    bookings = [booking({})];
    const { user } = mount();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(writes()).toEqual([]);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("shows the server's refusal on the row and changes nothing else", async () => {
    bookings = [booking({})];
    replies.push({
      status: 400,
      body: {
        ok: false,
        error: "A booking that has already started can't be cancelled.",
      },
    });
    const { user, onChanged } = mount();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));
    expect(await within(row("Booth 1")).findByRole("alert")).toHaveProperty(
      "textContent",
      "A booking that has already started can't be cancelled.",
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("says so when the server cannot be reached", async () => {
    bookings = [booking({})];
    replies.push("drop");
    const { user } = mount();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
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

  it("opens on the current end with Save off until it changes", async () => {
    bookings = [ongoing()];
    mount();
    await waitFor(() => expect(field("hours")).toBeTruthy());
    expect([field("hours").value, field("minutes").value]).toEqual([
      "12",
      "30",
    ]);
    expect(save().disabled).toBe(true);
  });

  it("sends the new end, tells the page and reseeds from the saved booking", async () => {
    bookings = [ongoing()];
    const { user, onChanged } = mount();
    await waitFor(() => expect(field("hours")).toBeTruthy());
    await user.click(field("hours"));
    await user.keyboard("{ArrowUp}");
    expect(save().disabled).toBe(false);

    bookings = [{ ...ongoing(), endsAt: at("13:30") }];
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
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(save().disabled).toBe(true);
  });

  it("will not send an end at or before now, naming the earliest it takes", async () => {
    bookings = [ongoing()];
    const { user } = mount();
    await waitFor(() => expect(field("minutes")).toBeTruthy());
    await user.click(field("minutes"));
    await user.keyboard("00");
    expect(save().disabled).toBe(true);
    expect(within(row("Booth 1")).getByRole("alert").textContent).toBe(
      "Pick 12:05 or later.",
    );
  });

  it("will not send an end off the grid", async () => {
    bookings = [ongoing()];
    const { user } = mount();
    await waitFor(() => expect(field("minutes")).toBeTruthy());
    await user.click(field("minutes"));
    await user.keyboard("33");
    expect(save().disabled).toBe(true);
    expect(within(row("Booth 1")).getByRole("alert").textContent).toBe(
      "Please choose times in 5-minute steps.",
    );
  });

  it("shows a clash the server reports, keeping the typed end", async () => {
    bookings = [ongoing()];
    replies.push({
      status: 409,
      body: { ok: false, error: "That time slot is no longer available." },
    });
    const { user, onChanged } = mount();
    await waitFor(() => expect(field("hours")).toBeTruthy());
    await user.click(field("hours"));
    await user.keyboard("{ArrowUp}");
    await user.click(save());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That time slot is no longer available.",
    );
    expect(field("hours").value).toBe("13");
    expect(onChanged).not.toHaveBeenCalled();
  });
});
