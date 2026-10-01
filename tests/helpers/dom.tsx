import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import ReservationClient from "@/app/ReservationClient";

export const DAYS = ["2026-07-16", "2026-07-17", "2026-07-18"];

export const NOTE_DEMAND =
  "Please add a note saying what the reservation is for - back to back with your other bookings this comes to 2 hours or more.";

interface Taken {
  start: string;
  end: string;
  label: string;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

type Booking = Record<string, string>;

export const reply = {
  noteDemand: {
    status: 400,
    body: { ok: false, field: "note", error: NOTE_DEMAND },
  },
  clash: {
    status: 409,
    body: { ok: false, error: "That overlaps an existing reservation." },
  },
  badEmail: {
    status: 400,
    body: { ok: false, field: "email", error: "That domain takes no mail." },
  },
  badName: {
    status: 400,
    body: { ok: false, field: "fullName", error: "Please enter your name." },
  },
  throttled: {
    status: 429,
    body: { ok: false, error: "Too many reservations. Try again later." },
  },
  booked: (b: Booking, status = "confirmed"): Reply => ({
    status: 201,
    body: {
      ok: true,
      cancelToken: "tok-new",
      reservation: {
        id: "r1",
        status,
        boothId: b.boothId,
        startsAt: `${b.date}T${b.start}`,
        endsAt: `${b.date}T${b.end}`,
      },
    },
  }),
};

/** A promise the test settles by hand, to hold a reply back mid-flight. */
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

/** A scripted server behind `fetch`: every call recorded, every reply the test's choice. */
export function fakeServer() {
  const server = {
    gets: [] as { booth: string; date: string; fresh: boolean }[],
    posts: [] as Booking[],
    cancels: [] as Booking[],
    taken: (() => []) as (booth: string, date: string) => Taken[],
    earliest: "00:00",
    /** Used up in order; once empty, `otherwise` answers. */
    replies: [] as (Reply | ((b: Booking) => Reply))[],
    otherwise: ((b: Booking) => reply.booked(b)) as (b: Booking) => Reply,
    /** "drop" rejects like a lost connection; "html" answers with a gateway page. */
    boardFails: null as null | "drop" | "html",
    postFails: false,
    boardGate: null as ReturnType<typeof gate> | null,
    postGate: null as ReturnType<typeof gate> | null,
    holdBoard() {
      return (server.boardGate = gate());
    },
    holdPost() {
      return (server.postGate = gate());
    },
  };

  const json = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, "http://localhost");
      if (u.pathname === "/api/availability") {
        const booth = u.searchParams.get("booth") ?? "";
        const date = u.searchParams.get("date") ?? "";
        server.gets.push({ booth, date, fresh: u.searchParams.has("t") });
        const held = server.boardGate;
        server.boardGate = null;
        if (held) await held.wait;
        if (server.boardFails === "drop")
          throw new TypeError("Failed to fetch");
        if (server.boardFails === "html")
          return {
            ok: false,
            status: 502,
            json: async () => JSON.parse("<html>"),
          };
        return json(200, {
          ok: true,
          booth,
          date,
          reserved: server.taken(booth, date),
          counts: {},
          earliest: server.earliest,
        });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as Booking;
      if (u.pathname === "/api/cancel") {
        server.cancels.push(body);
        return json(200, { ok: true });
      }
      server.posts.push(body);
      const held = server.postGate;
      server.postGate = null;
      if (held) await held.wait;
      if (server.postFails) throw new TypeError("Failed to fetch");
      const next = server.replies.shift() ?? server.otherwise;
      const r = typeof next === "function" ? next(body) : next;
      return json(r.status, r.body);
    }),
  );
  return server;
}

const widths = { bar: 0, tick: 0, tag: 0, tagText: 0 };
const observers = new Set<{ notify: () => void; watched: Set<Element> }>();

const widthOf = (el: Element) => {
  if (el.classList.contains("daycal-bar")) return widths.bar;
  if (el.classList.contains("daycal-tick-sizer")) return widths.tick;
  if (el.classList.contains("daycal-pick-tag")) return widths.tag;
  if (el.parentElement?.classList.contains("daycal-pick-tag"))
    return widths.tagText;
  return 0;
};

/** jsdom lays nothing out, so the widths the timeline measures are supplied here. */
export function fakeLayout(initial: Partial<typeof widths> = {}) {
  Object.assign(widths, { bar: 0, tick: 0, tag: 0, tagText: 0 }, initial);
  observers.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private entry: { notify: () => void; watched: Set<Element> };
      constructor(notify: () => void) {
        this.entry = { notify, watched: new Set() };
      }
      observe(el: Element) {
        this.entry.watched.add(el);
        observers.add(this.entry);
      }
      unobserve() {}
      disconnect() {
        observers.delete(this.entry);
      }
    },
  );
  for (const prop of ["offsetWidth", "clientWidth"] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return widthOf(this);
      },
    });
  }
  return {
    /** New measurements; like the real thing, only an observer of a changed element hears. */
    resize(next: Partial<typeof widths>) {
      const was = new Map<Element, number>();
      for (const o of observers)
        for (const el of o.watched) was.set(el, widthOf(el));
      Object.assign(widths, next);
      act(() => {
        for (const o of observers)
          if ([...o.watched].some((el) => widthOf(el) !== was.get(el)))
            o.notify();
      });
    },
  };
}

/** The booking screen mounted on three booths and three days, with a user to drive it. */
export function mountForm() {
  const user = userEvent.setup();
  const view = render(
    <ReservationClient
      booths={[
        { id: "booth-1", name: "Booth 1", capacity: 2 },
        { id: "booth-2", name: "Booth 2", capacity: 4 },
        { id: "booth-3", name: "Booth 3", capacity: 6 },
      ]}
      dates={DAYS.map((value, i) => ({ value, label: `Day ${i + 1}` }))}
      autoApproveMaxHours={2}
      minReservationMinutes={15}
      stepMinutes={5}
      contact={{ phone: "+355 00 000", email: "hello@test.test" }}
    />,
  );
  return { user, ...view };
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement;

/** What the form shows right now, read the way a person or a screen reader would. */
export const form = {
  name: () => input("fullName"),
  email: () => input("email"),
  note: () => document.getElementById("note") as HTMLTextAreaElement,
  reserve: () =>
    document.querySelector(".reserve-bar button") as HTMLButtonElement,
  booth: (n: number) =>
    document.querySelectorAll<HTMLButtonElement>(".booth-card")[n - 1],
  day: (n: number) =>
    document.querySelectorAll<HTMLButtonElement>(".date-row .chip")[n - 1],
  hour: (from: string, to: string) =>
    document.querySelector<HTMLButtonElement>(
      `.daycal-cell[aria-label="Reserve ${from} to ${to}"]`,
    )!,
  /** "09:00-10:00", or null while the picker is not on screen. */
  pick: () => {
    const v = (id: string) => input(id)?.value;
    if (v("start-hours") == null) return null;
    return `${v("start-hours")}:${v("start-minutes")}-${v("end-hours")}:${v("end-minutes")}`;
  },
  isRed: (el: HTMLElement) =>
    el.classList.contains("invalid") &&
    el.getAttribute("aria-invalid") === "true",
  /** The text assistive technology reads with this field, via aria-describedby. */
  reasonFor: (el: HTMLElement) => {
    const id = el.getAttribute("aria-describedby");
    return id ? (document.getElementById(id)?.textContent ?? "") : "";
  },
  alerts: () =>
    [...document.querySelectorAll("p.error")].map((p) => p.textContent ?? ""),
  banner: () => document.querySelector("p.success")?.textContent ?? "",
  timeCard: () => document.querySelector(".time-card")?.textContent ?? "",
  noteRequired: () =>
    form.note().getAttribute("aria-required") === "true" &&
    form.note().placeholder.startsWith("Note (required"),
};
