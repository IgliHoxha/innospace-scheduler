// @vitest-environment jsdom
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardClient from "@/app/dashboard/DashboardClient";
import type { Reservation, ReservationStatus } from "@/lib/types";

type Props = ComponentProps<typeof DashboardClient>;
type Page = Props["initialData"];
type User = ReturnType<typeof userEvent.setup>;

// The search debounce runs on the real clock, which a loaded machine stretches.
configure({ asyncUtilTimeout: 4000 });
// Room for a test that waits on that debounce more than once under load.
vi.setConfig({ testTimeout: 15000 });

const CONTACT = {
  name: "Test Signer",
  org: "Test Org",
  phone: "+000 000",
  email: "hello@test.test",
  url: "https://test.test",
};
const BOOTHS = [
  { id: "booth-1", name: "Booth 1", capacity: 2 },
  { id: "booth-2", name: "Booth 2", capacity: 4 },
];
// Every box a different number, so two swapped boxes cannot read the same.
const COUNTS = {
  total: 10,
  pending: 2,
  confirmed: 5,
  cancelled: 3,
  deleted: 4,
};
const STATS = [
  ["Total", "10"],
  ["Awaiting", "2"],
  ["Confirmed", "5"],
  ["Cancelled", "3"],
  ["Deleted", "4"],
];
const HEADS = [
  "Reserved at",
  "Member",
  "Booth",
  "Date",
  "Time",
  "Note",
  "Status",
  "Email",
  "Action",
];

function booking(
  id: string,
  status: ReservationStatus,
  over: Partial<Reservation> = {},
): Reservation {
  return {
    id,
    status,
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    boothId: "booth-1",
    startsAt: "2026-07-16T09:00",
    endsAt: "2026-07-16T10:00",
    note: "",
    // No zone suffix, so the cell reads the same in whatever zone the suite runs.
    createdAt: "2026-07-10T08:05:00",
    updatedAt: "2026-07-11T17:40:00",
    ...over,
  };
}

const ADA = booking("p1", "pending", { note: "client call" });
const BOB = booking("c1", "confirmed", {
  fullName: "Bob Stone",
  email: "bob@example.com",
  boothId: "booth-2",
  startsAt: "2026-07-17T14:30",
  endsAt: "2026-07-17T16:00",
});
const CY = booking("x1", "cancelled", {
  fullName: "Cy Young",
  email: "cy@example.com",
});
const ROWS = [ADA, BOB, CY];
const NAMES = ["Ada Lovelace", "Bob Stone", "Cy Young"];
const GONE = [
  booking("d1", "deleted", { fullName: "Dee Gone" }),
  booking("d2", "deleted", { fullName: "Eli Gone" }),
  booking("d3", "deleted", { fullName: "" }),
];

const many = (n: number, status: ReservationStatus = "confirmed") =>
  Array.from({ length: n }, (_, i) =>
    booking(`m${i + 1}`, status, { fullName: `Guest ${i + 1}` }),
  );
const guests = (from: number, to: number) =>
  many(to)
    .slice(from - 1)
    .map((r) => r.fullName);

const page = (
  reservations: Reservation[],
  total = reservations.length,
): Page => ({ reservations, total, page: 1, pageSize: 25, counts: COUNTS });

/** The cancellation email written out in full, so a reworded template fails here. */
const letter = (hello: string, what: string) =>
  [
    hello,
    "",
    "Thank you for reserving a meeting booth at Test Org.",
    "",
    `We're sorry to let you know that your reservation for ${what} has been cancelled.`,
    "",
    "We sincerely apologize for the inconvenience. Please feel free to reserve another slot at your convenience, or reply to this email and we'll be glad to help.",
    "",
    "Best regards,",
    "Test Signer",
    "",
    "Phone: +000 000",
    "Email: hello@test.test",
  ].join("\n");

const THURSDAY = "Booth 1 on Thursday, 16 July 2026 (09:00 - 10:00)";
const ADA_LETTER = letter("Hello Ada,", THURSDAY);
const BOB_LETTER = letter(
  "Hello Bob,",
  "Booth 2 on Friday, 17 July 2026 (14:30 - 16:00)",
);
const CY_LETTER = letter("Hello Cy,", THURSDAY);

interface Query {
  status: string;
  q: string;
  page: number;
  counts: boolean;
}

/** A request as the server reads it: the query as a map, so key order is free. */
interface Call {
  method: string;
  path: string;
  query?: Record<string, string>;
  type?: string | null;
  body?: unknown;
}

/** A promise the test settles by hand, to hold a reply back mid-flight. */
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

/** A scripted server behind `fetch`: every call recorded, every reply the test's choice. */
function fakeApi() {
  const api = {
    calls: [] as Call[],
    /** Every row the asked filter and search match; the asked page is cut out of it. */
    matching: (() => ROWS) as (q: Query) => Reservation[],
    /** Sent only with a reply that was asked for counts, as the real route does. */
    counts: COUNTS,
    /** Answers a list request the way an expired session would. */
    refuses: false,
    /** Answers a PATCH or DELETE the way a server that will not do it would. */
    refusesWrites: false,
    /** "drop" rejects a list request like a lost connection; "html" answers with a gateway page. */
    listFails: null as null | "drop" | "html",
    gates: [] as ReturnType<typeof gate>[],
    /** Holds the next request back, whichever it is, until the test opens it. */
    hold() {
      const held = gate();
      api.gates.push(held);
      return held;
    },
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const [path, search] = url.split("?");
      const call: Call = { method: init?.method ?? "GET", path };
      if (search !== undefined) {
        call.query = Object.fromEntries(new URLSearchParams(search));
      }
      if (init?.body != null) {
        call.type = new Headers(init.headers).get("content-type");
        call.body = JSON.parse(String(init.body));
      }
      api.calls.push(call);
      const held = api.gates.shift();
      if (held) await held.wait;

      const json = (status: number, body: unknown) => ({
        ok: status < 300,
        status,
        json: async () => body,
      });
      if (call.method !== "GET") {
        return api.refusesWrites
          ? json(409, { ok: false, error: "That reservation changed." })
          : json(200, { ok: true });
      }
      if (api.listFails === "drop") throw new TypeError("Failed to fetch");
      if (api.listFails === "html") {
        return { ok: false, status: 502, json: async () => JSON.parse("<") };
      }
      if (api.refuses) return json(401, { ok: false, error: "Unauthorized" });
      const asked = call.query ?? {};
      const q = {
        status: asked.status ?? "",
        q: asked.q ?? "",
        page: Number(asked.page),
        counts: asked.counts === "1",
      };
      const all = api.matching(q);
      return json(200, {
        ok: true,
        reservations: all.slice((q.page - 1) * 25, q.page * 25),
        total: all.length,
        page: q.page,
        pageSize: 25,
        ...(q.counts ? { counts: api.counts } : {}),
      });
    }),
  );
  return api;
}

/** The list request as it goes out, every parameter in its place. */
const listed = (
  status: string,
  { q = "", page = 1, counts = 0 } = {},
): Call => ({
  method: "GET",
  path: "/api/reservations",
  query: {
    status,
    q,
    page: String(page),
    pageSize: "25",
    counts: String(counts),
  },
});

const patched = (id: string, body: Record<string, string>): Call => ({
  method: "PATCH",
  path: `/api/reservations/${id}`,
  type: "application/json",
  body,
});

const purged = (ids: string[]): Call => ({
  method: "DELETE",
  path: "/api/reservations",
  type: "application/json",
  body: { ids },
});

const all = <T extends HTMLElement = HTMLElement>(
  css: string,
  root: ParentNode = document,
) => [...root.querySelectorAll<T>(css)];

const text = (el: Element | null | undefined) => el?.textContent ?? null;
const isOn = (el: Element) => el.classList.contains("active");

/** Found by role, so a box or chip that stops being a button drops out. */
const statBoxes = () =>
  within(
    document.querySelector<HTMLElement>(".stats")!,
  ).getAllByRole<HTMLButtonElement>("button");
const toolbar = () => within(document.querySelector<HTMLElement>(".toolbar")!);
const label = (box: Element) => text(box.querySelector(".label"));

/** What the dashboard shows right now, read the way an admin or a screen reader would. */
const dash = {
  stats: () =>
    statBoxes().map((b) => [label(b), text(b.querySelector(".num"))]),
  chips: () => toolbar().getAllByRole("button").map(text),
  /** The marked stat box and the marked chip: both follow the one filter. */
  active: () => ({
    stat: statBoxes().filter(isOn).map(label),
    chip: toolbar().getAllByRole("button").filter(isOn).map(text),
  }),
  stat: (name: string) => statBoxes().find((b) => label(b) === name)!,
  chip: (name: string) =>
    toolbar().getByRole<HTMLButtonElement>("button", { name }),
  search: () => screen.getByRole<HTMLInputElement>("searchbox"),
  busy: () => document.querySelector(".card")?.getAttribute("aria-busy"),
  empty: () => text(document.querySelector(".card .empty")),
  heads: () => all("thead th").map(text),
  rows: () => all<HTMLTableRowElement>("tbody tr"),
  row: (n: number) => dash.rows()[n - 1],
  /** Found by its column head, so the checkbox column cannot shift it. */
  cell: (n: number, head: string) =>
    dash.row(n).children[dash.heads().indexOf(head)] as HTMLElement,
  read: (n: number) => ({
    reservedAt: text(dash.cell(n, "Reserved at")),
    name: text(dash.cell(n, "Member").querySelector("strong")),
    email: text(dash.cell(n, "Member").querySelector("small a")),
    booth: text(dash.cell(n, "Booth")),
    date: text(dash.cell(n, "Date")),
    time: text(dash.cell(n, "Time")),
    note: text(dash.cell(n, "Note")),
    status: text(dash.cell(n, "Status")),
  }),
  names: () => all("tbody td.who strong").map(text),
  statuses: () => all("tbody .badge").map(text),
  /** Each action of a row as its label and whether it is switched off. */
  actions: (n: number) =>
    all<HTMLButtonElement>("button", dash.cell(n, "Action")).map((b) => [
      b.getAttribute("aria-label"),
      b.disabled,
    ]),
  button: (n: number, name: string) =>
    within(dash.row(n)).getByRole<HTMLButtonElement>("button", { name }),
  tooltip: () => text(document.querySelector('[role="tooltip"]')),
  draft: (n: number) =>
    within(dash.row(n)).getByRole<HTMLTextAreaElement>("textbox"),
  email: (n: number) => {
    const cell = dash.cell(n, "Email");
    const box = cell.querySelector("textarea");
    return {
      state: text(cell.querySelector(".email-sent")),
      subject: text(cell.querySelector(".email-subject")),
      name: box?.getAttribute("aria-label"),
      body: box?.value,
      locked: box?.readOnly,
      cap: box?.getAttribute("maxlength"),
    };
  },
  dialog: () => {
    const box = screen.queryByRole("dialog");
    if (!box) return null;
    const buttons = within(box).getAllByRole("button");
    return {
      title: text(within(box).getByRole("heading")),
      says: text(box.querySelector("p")),
      /** What the message sets in bold: the guest's name or the purge count. */
      bold: all("p strong", box).map(text),
      buttons: buttons.map(text),
      /** Whether the answer that acts is styled as one that loses something. */
      danger: buttons
        .find((b) => text(b)?.startsWith("Yes"))
        ?.classList.contains("danger"),
    };
  },
  answer: (name: string) =>
    within(screen.getByRole("dialog")).getByRole("button", { name }),
  info: () => text(document.querySelector(".pagination-info")),
  pager: () => all(".pagination-controls > *").map(text),
  /** Each pager button as its text and whether it is switched off. */
  pagerState: () =>
    all<HTMLButtonElement>(".pagination-controls button").map((b) => [
      text(b),
      b.disabled,
    ]),
  current: () => all('.pagination-controls [aria-current="page"]').map(text),
  /** The page button drawn as the current one. */
  marked: () => all(".pagination-controls button").filter(isOn).map(text),
  page: (name: string) =>
    within(
      document.querySelector<HTMLElement>(".pagination-controls")!,
    ).getByRole<HTMLButtonElement>("button", { name }),
  bulk: () => document.querySelector<HTMLElement>(".bulk-bar"),
  selected: () => text(document.querySelector(".bulk-count")),
  /** The bulk bar's box first, then the one heading the table. */
  selectAll: () =>
    screen.getAllByRole<HTMLInputElement>("checkbox", { name: "Select all" }),
  tick: (n: number) =>
    within(dash.row(n)).getByRole<HTMLInputElement>("checkbox"),
  ticks: () =>
    all<HTMLInputElement>('tbody input[type="checkbox"]').map((c) => c.checked),
  purge: () =>
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Delete permanently",
    }),
};

let api: ReturnType<typeof fakeApi>;
const strays: (() => void)[] = [];

beforeEach(() => {
  api = fakeApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const stop of strays.splice(0)) stop();
});

function mount(initial: Page = page(ROWS), username = "admin") {
  // No pause between keys, so the debounce cannot fire in the middle of a word.
  const user = userEvent.setup({ delay: null });
  const view = render(
    <DashboardClient
      initialData={initial}
      username={username}
      contact={CONTACT}
      booths={BOOTHS}
    />,
  );
  return { user, ...view };
}

/** The dashboard switched to its Deleted filter, with these rows in. */
async function openDeleted(rows = GONE) {
  api.matching = (q) => (q.status === "deleted" ? rows : ROWS);
  const view = mount();
  await view.user.click(dash.chip("Deleted"));
  await waitFor(() => expect(dash.busy()).toBe("false"));
  expect(dash.statuses()).toEqual(rows.slice(0, 25).map(() => "deleted"));
  return view;
}

/** Presses a control only once it is enabled, so a late render cannot swallow the press. */
async function press(user: User, find: () => HTMLButtonElement) {
  await waitFor(() => expect(find().disabled).toBe(false));
  await user.click(find());
}

/** Only the debounce timer is faked, so nothing in the test waits on a real clock. */
function fakeDebounce() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
}

/** Lets every reply already let through land; the fake server answers without timers. */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

/** The page lets a failed list request reject unheard; a listener here tells Vitest that is expected. */
function allowStrayRejection() {
  const hear = () => {};
  process.on("unhandledRejection", hear);
  strays.push(() => process.off("unhandledRejection", hear));
}

/** The four ways out of a dialog that must not act; Enter at once lands on No. */
const WAYS_OUT: ((user: User) => Promise<void>)[] = [
  (user) => user.click(dash.answer("No")),
  (user) => user.keyboard("{Enter}"),
  (user) => user.keyboard("{Escape}"),
  (user) => user.click(document.querySelector(".modal-overlay")!),
];

describe("first render", () => {
  it("shows the page it was given and asks the server for nothing", () => {
    const tick = fakeDebounce();
    mount();
    expect(dash.names()).toEqual(NAMES);
    expect(dash.busy()).toBe("false");
    tick(1000);
    expect(api.calls).toEqual([]);
  });

  it("counts each status in a stat box, with Total marked", () => {
    mount();
    expect(dash.stats()).toEqual(STATS);
    expect(dash.active().stat).toEqual(["Total"]);
  });

  it("offers the same five filters as chips, with All marked", () => {
    mount();
    expect(dash.chips()).toEqual([
      "All",
      "Awaiting approval",
      "Confirmed",
      "Cancelled",
      "Deleted",
    ]);
    expect(dash.active().chip).toEqual(["All"]);
  });

  it("heads the page, the search box and the table", () => {
    mount();
    expect(
      [...document.querySelector(".page-head")!.children].map(text),
    ).toEqual([
      "Innospace Tirana",
      "Reservations",
      "Review booth reservations, approve or cancel, and send the guest their email - all in one place.",
    ]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Reservations",
    );
    expect(dash.search().placeholder).toBe("Search name, email, booth, note…");
    expect(dash.search().value).toBe("");
    expect(dash.search().id).toBe("search");
    expect(dash.search().name).toBe("search");
    expect(dash.heads()).toEqual(HEADS);
  });

  it("names who is signed in and links the brand back to the dashboard", () => {
    mount(page(ROWS), "igli");
    expect(screen.getByText("igli")).toBeTruthy();
    const brand = screen.getByRole("link", { name: "Scheduler dashboard" });
    expect(brand.getAttribute("href")).toBe("/dashboard");
  });

  it("ends with the site footer", () => {
    mount();
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toBe(
      `© ${new Date().getFullYear()} Innospace Tirana. All rights reserved.`,
    );
    expect(within(footer).getByRole("img").getAttribute("alt")).toBe(
      "Innospace Tirana",
    );
  });
});

describe("filtering", () => {
  const FILTERS = [
    { status: "pending", stat: "Awaiting", chip: "Awaiting approval" },
    { status: "confirmed", stat: "Confirmed", chip: "Confirmed" },
    { status: "cancelled", stat: "Cancelled", chip: "Cancelled" },
    { status: "deleted", stat: "Deleted", chip: "Deleted" },
    { status: "all", stat: "Total", chip: "All" },
  ];
  const KINDS = [
    ["stat", "stat box"],
    ["chip", "chip"],
  ] as const;

  for (const [kind, called] of KINDS) {
    it(`asks for the pressed status from page one, by ${called}`, async () => {
      const { user } = mount();
      for (const f of FILTERS) {
        await user.click(dash[kind](f[kind]));
        expect(api.calls.at(-1)).toEqual(listed(f.status));
        expect(dash.active()).toEqual({ stat: [f.stat], chip: [f.chip] });
      }
      expect(api.calls).toHaveLength(FILTERS.length);
    });

    it(`keeps the search typed so far when a ${called} is pressed`, async () => {
      const { user } = mount();
      await user.type(dash.search(), "guest");
      await waitFor(() =>
        expect(api.calls).toEqual([listed("all", { q: "guest" })]),
      );
      await user.click(dash[kind]("Confirmed"));
      expect(dash.search().value).toBe("guest");
      expect(api.calls).toEqual([
        listed("all", { q: "guest" }),
        listed("confirmed", { q: "guest" }),
      ]);
    });
  }

  it("lists what the server answers with", async () => {
    api.matching = (q) => ROWS.filter((r) => r.status === q.status);
    const { user } = mount();
    await user.click(dash.chip("Confirmed"));
    await waitFor(() => expect(dash.names()).toEqual(["Bob Stone"]));
    expect(dash.info()).toBe("1-1 of 1");
    expect(api.calls).toEqual([listed("confirmed")]);
  });

  it("asks once for a filter with no rows, and says there is nothing to show", async () => {
    api.matching = (q) => (q.status === "deleted" ? [] : ROWS);
    const { user } = mount();
    await user.click(dash.chip("Deleted"));
    await waitFor(() => expect(dash.empty()).toBe("No reservations to show."));
    expect(dash.busy()).toBe("false");
    expect(dash.info()).toBeNull();
    expect(api.calls).toEqual([listed("deleted")]);
  });

  it("sends nothing when the pressed filter is already on", async () => {
    const { user } = mount();
    await user.click(dash.chip("All"));
    await user.click(dash.stat("Total"));
    expect(api.calls).toEqual([]);
  });

  it("goes back to page one from a later page", async () => {
    api.matching = () => many(60);
    const { user } = mount(page(many(25), 60));
    await user.click(dash.page("3"));
    await waitFor(() => expect(dash.info()).toBe("51-60 of 60"));
    await user.click(dash.chip("Confirmed"));
    await waitFor(() => expect(dash.info()).toBe("1-25 of 60"));
    expect(api.calls.at(-1)).toEqual(listed("confirmed"));
    expect(dash.current()).toEqual(["1"]);
    expect(dash.marked()).toEqual(["1"]);
  });
});

describe("searching", () => {
  it("sends one request for the whole text, not one for each key", async () => {
    api.matching = (q) => (q.q === "bob stone" ? [BOB] : ROWS);
    const { user } = mount();
    await user.type(dash.search(), "bob stone");
    await waitFor(() => expect(dash.names()).toEqual(["Bob Stone"]));
    expect(api.calls).toEqual([listed("all", { q: "bob stone" })]);
  });

  it("waits 300 ms after the last key before it asks", async () => {
    const tick = fakeDebounce();
    mount();
    fireEvent.change(dash.search(), { target: { value: "bo" } });
    tick(299);
    fireEvent.change(dash.search(), { target: { value: "bob" } });
    tick(299);
    expect(api.calls).toEqual([]);
    tick(1);
    expect(api.calls).toEqual([listed("all", { q: "bob" })]);
    await act(async () => {});
    expect(dash.busy()).toBe("false");
  });

  it("sends a filter pressed mid-word with the settled search, the new text only after its wait", async () => {
    const tick = fakeDebounce();
    mount();
    fireEvent.change(dash.search(), { target: { value: "bo" } });
    tick(100);
    fireEvent.click(dash.chip("Confirmed"));
    expect(api.calls).toEqual([listed("confirmed")]);
    tick(199);
    expect(api.calls).toHaveLength(1);
    tick(1);
    expect(api.calls).toEqual([
      listed("confirmed"),
      listed("confirmed", { q: "bo" }),
    ]);
    await act(async () => {});
    expect(dash.busy()).toBe("false");
  });

  it("sends the text exactly as typed, capitals and spaces kept", async () => {
    const tick = fakeDebounce();
    mount();
    fireEvent.change(dash.search(), { target: { value: " Bob " } });
    tick(300);
    expect(api.calls).toEqual([listed("all", { q: " Bob " })]);
    await act(async () => {});
    expect(dash.busy()).toBe("false");
  });

  it("goes back to page one", async () => {
    api.matching = (q) => many(q.q ? 30 : 60);
    const { user } = mount(page(many(25), 60));
    await user.click(dash.page("2"));
    await waitFor(() => expect(dash.info()).toBe("26-50 of 60"));
    await user.type(dash.search(), "guest");
    await waitFor(() => expect(dash.info()).toBe("1-25 of 30"));
    expect(api.calls.at(-1)).toEqual(listed("all", { q: "guest" }));
    expect(dash.current()).toEqual(["1"]);
  });

  it("keeps the filter that is on", async () => {
    const { user } = mount();
    await user.click(dash.chip("Cancelled"));
    await user.type(dash.search(), "cy");
    await waitFor(() =>
      expect(api.calls.at(-1)).toEqual(listed("cancelled", { q: "cy" })),
    );
    expect(api.calls).toHaveLength(2);
  });
});

describe("a row", () => {
  it("shows when it was made, who for, where, when, why and its status", () => {
    mount();
    expect(dash.read(1)).toEqual({
      reservedAt: "10/07/26 08:05",
      name: "Ada Lovelace",
      email: "ada@example.com",
      booth: "Booth 1",
      date: "16/07/26",
      time: "09:00 - 10:00",
      note: "client call",
      status: "pending",
    });
    expect(dash.read(2)).toEqual({
      reservedAt: "10/07/26 08:05",
      name: "Bob Stone",
      email: "bob@example.com",
      booth: "Booth 2",
      date: "17/07/26",
      time: "14:30 - 16:00",
      note: "-",
      status: "confirmed",
    });
    expect(dash.statuses()).toEqual(["pending", "confirmed", "cancelled"]);
  });

  it("links the email, colours the badge by status, and shows nothing more", () => {
    mount();
    const link = within(dash.row(1)).getByRole("link", {
      name: "ada@example.com",
    });
    expect(link.getAttribute("href")).toBe("mailto:ada@example.com");
    const badges = all("tbody .badge");
    expect(
      badges.map((b) =>
        ["pending", "confirmed", "cancelled"].filter((s) =>
          b.classList.contains(s),
        ),
      ),
    ).toEqual([["pending"], ["confirmed"], ["cancelled"]]);
    // Every cell word for word, so an extra detail such as the updated time shows.
    expect([...dash.row(1).children].map(text)).toEqual([
      "10/07/26 08:05",
      "Ada Lovelaceada@example.com",
      "Booth 1",
      "16/07/26",
      "09:00 - 10:00",
      "client call",
      "pending",
      `Cancellation emailSubject: Update on your Booth 1 reservation at Test Org${ADA_LETTER}`,
      "",
    ]);
  });

  it("puts a dash, or the bare booth, wherever a detail is missing", () => {
    const bare: Reservation = {
      id: "b1",
      status: "confirmed",
      createdAt: "",
      updatedAt: "",
    };
    mount(
      page([
        bare,
        booking("b2", "confirmed", { boothId: "booth-9" }),
        booking("b3", "confirmed", { fullName: "" }),
      ]),
    );
    expect(dash.read(1)).toEqual({
      reservedAt: "-",
      name: "-",
      email: null,
      booth: "Booth",
      date: "-",
      time: "-",
      note: "-",
      status: "confirmed",
    });
    expect(dash.read(2).booth).toBe("booth-9");
    expect(dash.read(3).name).toBe("-");
    expect(dash.read(3).email).toBe("ada@example.com");
  });

  it("offers only the actions its status allows", async () => {
    mount();
    expect(dash.actions(1)).toEqual([
      ["Approve reservation", false],
      ["Reject reservation", false],
      ["Delete reservation", false],
    ]);
    expect(dash.actions(2)).toEqual([
      ["Cancel reservation", false],
      ["Delete reservation", false],
    ]);
    expect(dash.actions(3)).toEqual([
      ["Cancel reservation", true],
      ["Delete reservation", false],
    ]);
    cleanup();

    await openDeleted();
    expect(dash.actions(1)).toEqual([
      ["Cancel reservation", true],
      ["Delete reservation", true],
    ]);
  });

  it("draws each action with its own icon and colour", () => {
    mount();
    const buttons = all<HTMLButtonElement>("button", dash.cell(1, "Action"));
    expect(
      buttons.map((b) =>
        ["icon-btn", "tick", "cross", "trash"].filter((c) =>
          b.classList.contains(c),
        ),
      ),
    ).toEqual([
      ["icon-btn", "tick"],
      ["icon-btn", "cross"],
      ["icon-btn", "trash"],
    ]);
    const icon = (b: Element) => b.querySelector("svg path")?.getAttribute("d");
    expect(new Set(buttons.map(icon)).size).toBe(3);
    expect(icon(dash.button(2, "Cancel reservation"))).toBe(icon(buttons[1]));
    expect(icon(dash.button(2, "Delete reservation"))).toBe(icon(buttons[2]));
  });

  it("sets dates in their own style, keeps the note narrow and the email box seven lines tall", () => {
    mount();
    expect(
      ["Date", "Time"].map((h) => dash.cell(1, h).classList.contains("dates")),
    ).toEqual([true, true]);
    expect(dash.cell(1, "Reserved at").querySelector(".dates")).not.toBeNull();
    expect(dash.cell(1, "Note").style.maxWidth).toBe("200px");
    expect(dash.draft(1).rows).toBe(7);
  });

  it("names an action in a tooltip while the pointer is on it", async () => {
    const { user } = mount();
    expect(dash.tooltip()).toBeNull();
    for (const name of [
      "Approve reservation",
      "Reject reservation",
      "Delete reservation",
    ]) {
      await user.hover(dash.button(1, name));
      expect(dash.tooltip()).toBe(name);
      await user.unhover(dash.button(1, name));
      expect(dash.tooltip()).toBeNull();
    }

    await user.hover(dash.button(2, "Cancel reservation"));
    expect(dash.tooltip()).toBe("Cancel reservation");
    await user.click(dash.button(2, "Cancel reservation"));
    expect(dash.tooltip()).toBeNull();
  });

  it("shows the same tooltip to the keyboard, until focus moves on", async () => {
    const { user } = mount();
    act(() => dash.button(1, "Delete reservation").focus());
    expect(dash.tooltip()).toBe("Delete reservation");
    await user.tab();
    expect(dash.tooltip()).toBeNull();
  });
});

describe("the Email column", () => {
  it("drafts the cancellation email for a pending and for a confirmed row", () => {
    mount();
    expect(dash.email(1)).toEqual({
      state: "Cancellation email",
      subject: "Subject: Update on your Booth 1 reservation at Test Org",
      name: "cancellation email body",
      body: ADA_LETTER,
      locked: false,
      cap: "5000",
    });
    expect(dash.email(2)).toEqual({
      state: "Cancellation email",
      subject: "Subject: Update on your Booth 2 reservation at Test Org",
      name: "cancellation email body",
      body: BOB_LETTER,
      locked: false,
      cap: "5000",
    });
  });

  it("shows a cancelled row what was sent, and lets nobody edit it", async () => {
    const { user } = mount();
    expect(dash.email(3)).toEqual({
      state: "Cancellation sent",
      subject: "Subject: Update on your Booth 1 reservation at Test Org",
      name: "cancellation email body (sent)",
      body: CY_LETTER,
      locked: true,
      cap: null,
    });
    await user.type(dash.draft(3), "x");
    expect(dash.draft(3).value).toBe(CY_LETTER);
  });

  it("shows only a dash for a deleted row", async () => {
    await openDeleted();
    expect(text(dash.cell(1, "Email"))).toBe("-");
    expect(within(dash.row(1)).queryByRole("textbox")).toBeNull();
  });

  it("greets a guest with no name plainly", () => {
    mount(page([booking("n1", "confirmed", { fullName: "" })]));
    expect(dash.draft(1).value).toBe(letter("Hello,", THURSDAY));
  });

  it("stops an editable draft at 5000 characters", async () => {
    const { user } = mount();
    await user.clear(dash.draft(1));
    await user.paste("x".repeat(5001));
    expect(dash.draft(1).value).toBe("x".repeat(5000));
  });

  it("sends an edited draft with a later cancel, for that row only", async () => {
    const { user } = mount();
    await user.clear(dash.draft(1));
    await user.type(dash.draft(1), "The booth is closed that day.");
    expect(dash.draft(2).value).toBe(BOB_LETTER);

    api.matching = () => [ADA, { ...BOB, status: "cancelled" }, CY];
    await user.click(dash.button(2, "Cancel reservation"));
    await user.click(dash.answer("Yes, cancel"));
    await waitFor(() =>
      expect(dash.statuses()).toEqual(["pending", "cancelled", "cancelled"]),
    );
    expect(dash.draft(1).value).toBe("The booth is closed that day.");

    await user.click(dash.button(1, "Reject reservation"));
    await user.click(dash.answer("Yes, cancel"));
    await waitFor(() => expect(api.calls).toHaveLength(4));
    expect(api.calls).toEqual([
      patched("c1", { status: "cancelled", emailBody: BOB_LETTER }),
      listed("all", { counts: 1 }),
      patched("p1", {
        status: "cancelled",
        emailBody: "The booth is closed that day.",
      }),
      listed("all", { counts: 1 }),
    ]);
  });

  it("keeps one row's edit when another row is edited after it", async () => {
    const { user } = mount();
    await user.clear(dash.draft(1));
    await user.type(dash.draft(1), "The booth is closed that day.");
    await user.clear(dash.draft(2));
    await user.type(dash.draft(2), "Sorry, Bob.");
    expect(dash.draft(1).value).toBe("The booth is closed that day.");
    expect(dash.draft(2).value).toBe("Sorry, Bob.");

    await user.click(dash.button(1, "Reject reservation"));
    await user.click(dash.answer("Yes, cancel"));
    await waitFor(() => expect(api.calls).toHaveLength(2));
    expect(api.calls).toEqual([
      patched("p1", {
        status: "cancelled",
        emailBody: "The booth is closed that day.",
      }),
      listed("all", { counts: 1 }),
    ]);
  });

  it("keeps an edited draft through a change of filter and back", async () => {
    api.matching = (q) =>
      q.status === "all" ? ROWS : ROWS.filter((r) => r.status === q.status);
    const { user } = mount();
    await user.clear(dash.draft(2));
    await user.type(dash.draft(2), "Sorry, Bob.");

    await user.click(dash.chip("Confirmed"));
    await waitFor(() => expect(dash.names()).toEqual(["Bob Stone"]));
    expect(dash.draft(1).value).toBe("Sorry, Bob.");
    await user.click(dash.chip("All"));
    await waitFor(() => expect(dash.names()).toEqual(NAMES));
    expect(dash.draft(2).value).toBe("Sorry, Bob.");

    await user.click(dash.button(2, "Cancel reservation"));
    await user.click(dash.answer("Yes, cancel"));
    await waitFor(() => expect(api.calls).toHaveLength(4));
    expect(api.calls).toEqual([
      listed("confirmed"),
      listed("all"),
      patched("c1", { status: "cancelled", emailBody: "Sorry, Bob." }),
      listed("all", { counts: 1 }),
    ]);
  });

  for (const [what, typed] of [
    ["emptied", ""],
    ["with spaces and blank lines around it", "  Sorry, Bob.\n\n"],
  ] as const) {
    it(`sends a draft ${what} exactly as the box shows it`, async () => {
      const { user } = mount();
      await user.clear(dash.draft(2));
      if (typed) await user.paste(typed);
      expect(dash.draft(2).value).toBe(typed);
      await user.click(dash.button(2, "Cancel reservation"));
      await user.click(dash.answer("Yes, cancel"));
      await waitFor(() => expect(api.calls).toHaveLength(2));
      expect(api.calls).toEqual([
        patched("c1", { status: "cancelled", emailBody: typed }),
        listed("all", { counts: 1 }),
      ]);
    });
  }

  it("keeps the edited text on the row once it is cancelled", async () => {
    const { user } = mount();
    await user.clear(dash.draft(2));
    await user.type(dash.draft(2), "Sorry, Bob.");
    api.matching = () => [ADA, { ...BOB, status: "cancelled" }, CY];
    await user.click(dash.button(2, "Cancel reservation"));
    await user.click(dash.answer("Yes, cancel"));
    await waitFor(() =>
      expect(dash.statuses()).toEqual(["pending", "cancelled", "cancelled"]),
    );
    expect(dash.email(2)).toEqual({
      state: "Cancellation sent",
      subject: "Subject: Update on your Booth 2 reservation at Test Org",
      name: "cancellation email body (sent)",
      body: "Sorry, Bob.",
      locked: true,
      cap: null,
    });
  });
});

describe("the confirm dialog", () => {
  const GUESTS = [
    ["a named guest", { fullName: "Ada Lovelace", email: "ada@example.com" }],
    ["a guest with no name", { fullName: "", email: "ada@example.com" }],
    ["a guest with no email", { fullName: "Ada Lovelace", email: "" }],
  ] as const;

  const ASKS = [
    {
      verb: "approve",
      status: "pending",
      button: "Approve reservation",
      title: "Approve reservation?",
      yes: "Yes, approve",
      danger: false,
      says: [
        "Approve the reservation for Ada Lovelace? A confirmation email will be sent to ada@example.com.",
        "Approve the reservation? A confirmation email will be sent to ada@example.com.",
        "Approve the reservation for Ada Lovelace? (No email on file - nothing will be sent.)",
      ],
    },
    {
      verb: "reject",
      status: "pending",
      button: "Reject reservation",
      title: "Cancel reservation?",
      yes: "Yes, cancel",
      danger: true,
      says: [
        "Cancel the reservation for Ada Lovelace? The cancellation email (as shown in the Email column) will be sent to ada@example.com.",
        "Cancel the reservation? The cancellation email (as shown in the Email column) will be sent to ada@example.com.",
        "Cancel the reservation for Ada Lovelace? (No email on file - nothing will be sent.)",
      ],
    },
    {
      verb: "cancel",
      status: "confirmed",
      button: "Cancel reservation",
      title: "Cancel reservation?",
      yes: "Yes, cancel",
      danger: true,
      says: [
        "Cancel the reservation for Ada Lovelace? The cancellation email (as shown in the Email column) will be sent to ada@example.com.",
        "Cancel the reservation? The cancellation email (as shown in the Email column) will be sent to ada@example.com.",
        "Cancel the reservation for Ada Lovelace? (No email on file - nothing will be sent.)",
      ],
    },
    {
      verb: "delete",
      status: "confirmed",
      button: "Delete reservation",
      title: "Delete reservation?",
      yes: "Yes, delete",
      danger: true,
      says: [
        "Delete the reservation for Ada Lovelace? It will be hidden from the list (no email is sent).",
        "Delete the reservation? It will be hidden from the list (no email is sent).",
        "Delete the reservation for Ada Lovelace? It will be hidden from the list (no email is sent).",
      ],
    },
  ] as const;

  for (const { verb, status, button, title, yes, danger, says } of ASKS) {
    for (const [i, [who, guest]] of GUESTS.entries()) {
      it(`asks before it will ${verb}, word for word, for ${who}`, async () => {
        const { user } = mount(page([booking("r1", status, guest)]));
        await user.click(dash.button(1, button));
        expect(dash.dialog()).toEqual({
          title,
          says: says[i],
          bold: guest.fullName ? [guest.fullName] : [],
          buttons: ["No", yes],
          danger,
        });
      });
    }
  }

  for (const [row, button, title] of [
    [1, "Approve reservation", "Approve reservation?"],
    [1, "Reject reservation", "Cancel reservation?"],
    [2, "Cancel reservation", "Cancel reservation?"],
    [3, "Delete reservation", "Delete reservation?"],
  ] as const) {
    it(`sends nothing for ${button} when closed by No, Enter, Escape or the backdrop`, async () => {
      const { user } = mount();
      for (const leave of WAYS_OUT) {
        await user.click(dash.button(row, button));
        expect(dash.dialog()?.title).toBe(title);
        await leave(user);
        expect(dash.dialog()).toBeNull();
      }
      expect(api.calls).toEqual([]);
      expect(dash.statuses()).toEqual(["pending", "confirmed", "cancelled"]);
    });
  }
});

describe("confirming", () => {
  const WRITES = [
    {
      verb: "approve",
      row: 1,
      button: "Approve reservation",
      yes: "Yes, approve",
      sent: patched("p1", { status: "confirmed" }),
    },
    {
      verb: "reject",
      row: 1,
      button: "Reject reservation",
      yes: "Yes, cancel",
      sent: patched("p1", { status: "cancelled", emailBody: ADA_LETTER }),
    },
    {
      verb: "cancel",
      row: 2,
      button: "Cancel reservation",
      yes: "Yes, cancel",
      sent: patched("c1", { status: "cancelled", emailBody: BOB_LETTER }),
    },
    {
      verb: "delete",
      row: 3,
      button: "Delete reservation",
      yes: "Yes, delete",
      sent: patched("x1", { status: "deleted", emailBody: "" }),
    },
  ];

  for (const { verb, row, button, yes, sent } of WRITES) {
    it(`sends one PATCH to ${verb}, closes at once, then refetches with counts`, async () => {
      const { user } = mount();
      const write = api.hold();
      await user.click(dash.button(row, button));
      await user.click(dash.answer(yes));
      expect(dash.dialog()).toBeNull();
      expect(api.calls).toEqual([sent]);

      write.open();
      await waitFor(() => expect(api.calls).toHaveLength(2));
      expect(api.calls).toEqual([sent, listed("all", { counts: 1 })]);
    });
  }

  it("leaves the email text out of an approval altogether", async () => {
    const { user } = mount();
    await user.click(dash.button(1, "Approve reservation"));
    await user.click(dash.answer("Yes, approve"));
    expect(api.calls[0].body).toStrictEqual({ status: "confirmed" });
    expect(api.calls[0].type).toBe("application/json");
  });

  it("shows the rows and the stat numbers the refetch brings back", async () => {
    const { user } = mount();
    api.matching = () => [{ ...ADA, status: "confirmed" }, BOB, CY];
    api.counts = { ...COUNTS, pending: 1, confirmed: 6 };
    await user.click(dash.button(1, "Approve reservation"));
    await user.click(dash.answer("Yes, approve"));
    await waitFor(() =>
      expect(dash.statuses()).toEqual(["confirmed", "confirmed", "cancelled"]),
    );
    expect(dash.stats()).toEqual([
      ["Total", "10"],
      ["Awaiting", "1"],
      ["Confirmed", "6"],
      ["Cancelled", "3"],
      ["Deleted", "4"],
    ]);
    expect(dash.actions(1)).toEqual([
      ["Cancel reservation", false],
      ["Delete reservation", false],
    ]);
  });

  it("refetches with counts even when the server refuses the write", async () => {
    api.refusesWrites = true;
    const { user } = mount();
    await user.click(dash.button(2, "Cancel reservation"));
    await user.click(dash.answer("Yes, cancel"));
    await waitFor(() => expect(api.calls).toHaveLength(2));
    expect(api.calls).toEqual([
      patched("c1", { status: "cancelled", emailBody: BOB_LETTER }),
      listed("all", { counts: 1 }),
    ]);
    await waitFor(() => expect(dash.busy()).toBe("false"));
    expect(dash.statuses()).toEqual(["pending", "confirmed", "cancelled"]);
  });

  it("refetches the filter, the search and the page that are on screen", async () => {
    api.matching = () => many(60);
    const { user } = mount(page(many(25), 60));
    await user.click(dash.chip("Confirmed"));
    await user.type(dash.search(), "guest");
    await waitFor(() =>
      expect(api.calls.at(-1)).toEqual(listed("confirmed", { q: "guest" })),
    );
    await waitFor(() => expect(dash.info()).toBe("1-25 of 60"));
    await user.click(dash.page("2"));
    await waitFor(() => expect(dash.info()).toBe("26-50 of 60"));
    api.calls.length = 0;

    await user.click(dash.button(1, "Cancel reservation"));
    await user.click(dash.answer("Yes, cancel"));
    await waitFor(() => expect(api.calls).toHaveLength(2));
    expect(api.calls).toEqual([
      patched("m26", {
        status: "cancelled",
        emailBody: letter("Hello Guest,", THURSDAY),
      }),
      listed("confirmed", { q: "guest", page: 2, counts: 1 }),
    ]);
  });

  it("lands on the new last page when a write empties the one on screen", async () => {
    api.matching = () => many(26);
    const { user } = mount(page(many(25), 26));
    await user.click(dash.page("2"));
    await waitFor(() => expect(dash.info()).toBe("26-26 of 26"));
    api.calls.length = 0;

    api.matching = () => many(25);
    api.counts = { ...COUNTS, confirmed: 4, deleted: 5 };
    await user.click(dash.button(1, "Delete reservation"));
    await user.click(dash.answer("Yes, delete"));
    await waitFor(() => expect(dash.info()).toBe("1-25 of 25"));
    expect(dash.names()).toEqual(guests(1, 25));
    expect(dash.pager()).toEqual([]);
    expect(api.calls).toEqual([
      patched("m26", { status: "deleted", emailBody: "" }),
      listed("all", { page: 2, counts: 1 }),
      listed("all", { page: 1 }),
    ]);
    // The tallies came with the reply for the page that vanished, and must survive the step back.
    expect(dash.stats()).toEqual([
      ["Total", "10"],
      ["Awaiting", "2"],
      ["Confirmed", "4"],
      ["Cancelled", "3"],
      ["Deleted", "5"],
    ]);
  });
});

describe("pagination", () => {
  it("counts the rows on screen out of the total and lists the pages", () => {
    mount(page(many(25), 60));
    expect(dash.info()).toBe("1-25 of 60");
    expect(dash.pager()).toEqual(["‹ Prev", "1", "2", "3", "Next ›"]);
    expect(dash.current()).toEqual(["1"]);
    expect(dash.marked()).toEqual(["1"]);
    expect(dash.page("Previous page").disabled).toBe(true);
    expect(dash.page("Next page").disabled).toBe(false);
  });

  it("asks for the pressed page, by number or by Prev and Next", async () => {
    api.matching = () => many(60);
    const { user } = mount(page(many(25), 60));
    await user.click(dash.page("2"));
    await waitFor(() => expect(dash.info()).toBe("26-50 of 60"));
    expect(dash.names()[0]).toBe("Guest 26");
    expect(dash.current()).toEqual(["2"]);
    expect(dash.marked()).toEqual(["2"]);

    await press(user, () => dash.page("Next page"));
    await waitFor(() => expect(dash.info()).toBe("51-60 of 60"));
    expect(dash.names()).toHaveLength(10);
    expect(dash.current()).toEqual(["3"]);
    expect(dash.page("Next page").disabled).toBe(true);

    await press(user, () => dash.page("Previous page"));
    await waitFor(() => expect(dash.info()).toBe("26-50 of 60"));
    expect(dash.page("Previous page").disabled).toBe(false);
    expect(dash.page("Next page").disabled).toBe(false);
    expect(api.calls).toEqual([
      listed("all", { page: 2 }),
      listed("all", { page: 3 }),
      listed("all", { page: 2 }),
    ]);
  });

  it("moves Next one page at a time, far from the last page", async () => {
    api.matching = () => many(250);
    const { user } = mount(page(many(25), 250));
    await press(user, () => dash.page("Next page"));
    await waitFor(() => expect(dash.info()).toBe("26-50 of 250"));
    await press(user, () => dash.page("Next page"));
    await waitFor(() => expect(dash.info()).toBe("51-75 of 250"));
    expect(dash.current()).toEqual(["3"]);
    expect(api.calls).toEqual([
      listed("all", { page: 2 }),
      listed("all", { page: 3 }),
    ]);
  });

  it("shortens a long run of pages with a gap marker that is not a button", async () => {
    api.matching = () => many(250);
    const { user } = mount(page(many(25), 250));
    expect(dash.pager()).toEqual(["‹ Prev", "1", "2", "…", "10", "Next ›"]);
    for (const n of ["2", "3", "4"]) await user.click(dash.page(n));
    expect(dash.pager()).toEqual([
      "‹ Prev",
      "1",
      "…",
      "3",
      "4",
      "5",
      "…",
      "10",
      "Next ›",
    ]);
    expect(all(".pagination-controls button").map(text).includes("…")).toBe(
      false,
    );

    await user.click(dash.page("10"));
    expect(dash.pager()).toEqual(["‹ Prev", "1", "…", "9", "10", "Next ›"]);
    await waitFor(() => expect(dash.info()).toBe("226-250 of 250"));
    expect(dash.page("Next page").disabled).toBe(true);
  });

  it("has no page buttons when everything fits on one page", () => {
    mount();
    expect(dash.info()).toBe("1-3 of 3");
    expect(dash.pager()).toEqual([]);
  });

  it("is absent when there is nothing to show, and the card says so", () => {
    mount(page([]));
    expect(document.querySelector(".pagination")).toBeNull();
    expect(dash.empty()).toBe("No reservations to show.");
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("the Deleted filter", () => {
  it("offers the bulk bar only there, and only with rows", async () => {
    const { user } = await openDeleted();
    expect(dash.bulk()).not.toBeNull();
    expect(dash.heads()).toEqual(["", ...HEADS]);
    expect(dash.selectAll()).toHaveLength(2);
    expect(
      all('tbody input[type="checkbox"]').map((c) =>
        c.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Select reservation Dee Gone",
      "Select reservation Eli Gone",
      "Select reservation d3",
    ]);
    expect(dash.read(1).name).toBe("Dee Gone");

    await user.click(dash.chip("All"));
    expect(dash.bulk()).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(dash.heads()).toEqual(HEADS);
    cleanup();

    await openDeleted([]);
    expect(dash.bulk()).toBeNull();
    expect(dash.empty()).toBe("No reservations to show.");
    expect(dash.info()).toBeNull();
  });

  it("counts the rows ticked one at a time", async () => {
    const { user } = await openDeleted();
    expect(dash.selected()).toBe("0 selected");
    expect(dash.ticks()).toEqual([false, false, false]);

    await user.click(dash.tick(2));
    expect(dash.ticks()).toEqual([false, true, false]);
    expect(dash.selected()).toBe("1 selected");
    expect(dash.selectAll().map((c) => c.checked)).toEqual([false, false]);

    await user.click(dash.tick(1));
    await user.click(dash.tick(3));
    expect(dash.selected()).toBe("3 selected");
    expect(dash.selectAll().map((c) => c.checked)).toEqual([true, true]);

    await user.click(dash.tick(2));
    expect(dash.ticks()).toEqual([true, false, true]);
    expect(dash.selected()).toBe("2 selected");
    expect(dash.selectAll().map((c) => c.checked)).toEqual([false, false]);
  });

  it("ticks and clears every row from either Select all box", async () => {
    const { user } = await openDeleted();
    for (const which of [0, 1]) {
      await user.click(dash.selectAll()[which]);
      expect(dash.ticks()).toEqual([true, true, true]);
      expect(dash.selected()).toBe("3 selected");
      await user.click(dash.selectAll()[which]);
      expect(dash.ticks()).toEqual([false, false, false]);
      expect(dash.selected()).toBe("0 selected");
    }

    await user.click(dash.tick(2));
    await user.click(dash.selectAll()[0]);
    expect(dash.ticks()).toEqual([true, true, true]);
  });

  it("keeps Delete permanently off until a row is ticked, and red", async () => {
    const { user } = await openDeleted();
    expect(dash.purge().disabled).toBe(true);
    expect(dash.purge().classList.contains("danger")).toBe(true);

    await user.click(dash.tick(1));
    expect(dash.purge().disabled).toBe(false);
    await user.click(dash.tick(1));
    expect(dash.purge().disabled).toBe(true);
  });

  it("asks before purging, counting one reservation or several", async () => {
    const { user } = await openDeleted();
    await user.click(dash.tick(1));
    await press(user, dash.purge);
    expect(dash.dialog()).toEqual({
      title: "Delete permanently?",
      says: "This will permanently remove 1 reservation from the database. This cannot be undone.",
      bold: ["1 reservation"],
      buttons: ["No", "Yes, delete permanently"],
      danger: true,
    });

    await user.click(dash.answer("No"));
    await user.click(dash.tick(2));
    await press(user, dash.purge);
    expect(dash.dialog()?.says).toBe(
      "This will permanently remove 2 reservations from the database. This cannot be undone.",
    );
    expect(dash.dialog()?.bold).toEqual(["2 reservations"]);
  });

  it("purges nothing when that dialog is closed, and keeps the ticks", async () => {
    const { user } = await openDeleted();
    await user.click(dash.selectAll()[0]);
    for (const leave of WAYS_OUT) {
      await press(user, dash.purge);
      expect(dash.dialog()?.title).toBe("Delete permanently?");
      await leave(user);
      expect(dash.dialog()).toBeNull();
    }
    expect(dash.selected()).toBe("3 selected");
    expect(api.calls).toEqual([listed("deleted")]);
  });

  it("sends one DELETE with the ticked ids, then refetches with counts", async () => {
    const { user } = await openDeleted();
    await user.click(dash.tick(3));
    await user.click(dash.tick(1));
    api.matching = () => [GONE[1]];
    api.counts = { ...COUNTS, deleted: 1 };
    const write = api.hold();
    await press(user, dash.purge);
    await user.click(dash.answer("Yes, delete permanently"));
    expect(dash.dialog()).toBeNull();
    expect(dash.selected()).toBe("0 selected");
    expect(api.calls).toEqual([listed("deleted"), purged(["d3", "d1"])]);

    write.open();
    await waitFor(() => expect(dash.names()).toEqual(["Eli Gone"]));
    expect(api.calls).toEqual([
      listed("deleted"),
      purged(["d3", "d1"]),
      listed("deleted", { counts: 1 }),
    ]);
    expect(dash.stats()).toEqual([...STATS.slice(0, 4), ["Deleted", "1"]]);
    expect(dash.purge().disabled).toBe(true);
  });

  it("refetches with counts even when the server refuses the purge", async () => {
    const { user } = await openDeleted();
    await user.click(dash.tick(2));
    api.refusesWrites = true;
    await press(user, dash.purge);
    await user.click(dash.answer("Yes, delete permanently"));
    await waitFor(() => expect(api.calls).toHaveLength(3));
    expect(api.calls).toEqual([
      listed("deleted"),
      purged(["d2"]),
      listed("deleted", { counts: 1 }),
    ]);
    await waitFor(() => expect(dash.busy()).toBe("false"));
    expect(dash.names()).toEqual(["Dee Gone", "Eli Gone", "-"]);
  });

  it("sends every id on the page after Select all, in row order", async () => {
    const { user } = await openDeleted();
    await user.click(dash.selectAll()[1]);
    await press(user, dash.purge);
    await user.click(dash.answer("Yes, delete permanently"));
    expect(api.calls.at(1)).toEqual(purged(["d1", "d2", "d3"]));
  });

  it("forgets the ticks when the page, the search or the filter changes", async () => {
    const { user } = await openDeleted(many(30, "deleted"));
    await user.click(dash.tick(1));
    expect(dash.selected()).toBe("1 selected");
    await user.click(dash.page("2"));
    expect(dash.selected()).toBe("0 selected");
    await waitFor(() => expect(dash.info()).toBe("26-30 of 30"));

    await user.click(dash.tick(1));
    expect(dash.selected()).toBe("1 selected");
    await user.type(dash.search(), "guest");
    await waitFor(() => expect(dash.selected()).toBe("0 selected"));
    await waitFor(() => expect(dash.info()).toBe("1-25 of 30"));

    await user.click(dash.tick(1));
    expect(dash.selected()).toBe("1 selected");
    await user.click(dash.chip("All"));
    await waitFor(() =>
      expect(dash.statuses()).toEqual(["pending", "confirmed", "cancelled"]),
    );
    await user.click(dash.chip("Deleted"));
    await waitFor(() => expect(dash.info()).toBe("1-25 of 30"));
    expect(dash.selected()).toBe("0 selected");
    expect(dash.ticks()).not.toContain(true);
  });

  it("forgets the ticks when a search is typed on page one", async () => {
    const { user } = await openDeleted();
    api.matching = (q) => (q.q === "eli" ? [GONE[1]] : GONE);
    await user.click(dash.tick(1));
    expect(dash.selected()).toBe("1 selected");
    await user.type(dash.search(), "eli");
    await waitFor(() => expect(dash.names()).toEqual(["Eli Gone"]));
    expect(dash.selected()).toBe("0 selected");
    expect(dash.ticks()).toEqual([false]);
  });
});

describe("replies", () => {
  it("marks the card busy while one is on its way, and leaves the rows usable", async () => {
    const { user } = mount();
    const reply = api.hold();
    await user.click(dash.chip("Confirmed"));
    expect(dash.busy()).toBe("true");
    expect(dash.info()).toBe("1-3 of 3 · loading…");
    expect(dash.names()).toEqual(NAMES);
    expect(dash.actions(1)).toEqual([
      ["Approve reservation", false],
      ["Reject reservation", false],
      ["Delete reservation", false],
    ]);
    expect(dash.actions(2)).toEqual([
      ["Cancel reservation", false],
      ["Delete reservation", false],
    ]);

    reply.open();
    await waitFor(() => expect(dash.busy()).toBe("false"));
    expect(dash.info()).toBe("1-3 of 3");
  });

  it("leaves every page button usable while one is on its way", async () => {
    api.matching = () => many(60);
    const { user } = mount(page(many(25), 60));
    const reply = api.hold();
    await user.click(dash.page("2"));
    expect(dash.busy()).toBe("true");
    expect(dash.pagerState()).toEqual([
      ["‹ Prev", false],
      ["1", false],
      ["2", false],
      ["3", false],
      ["Next ›", false],
    ]);

    reply.open();
    await waitFor(() => expect(dash.info()).toBe("26-50 of 60"));
  });

  it("keeps the bulk bar on screen while one is on its way in the Deleted filter", async () => {
    const { user } = await openDeleted(many(30, "deleted"));
    const reply = api.hold();
    await user.click(dash.page("2"));
    expect(dash.busy()).toBe("true");
    expect(dash.bulk()).not.toBeNull();
    expect(dash.selected()).toBe("0 selected");

    reply.open();
    await waitFor(() => expect(dash.info()).toBe("26-30 of 30"));
    expect(dash.bulk()).not.toBeNull();
  });

  it("says Loading in place of an empty list while one is on its way", async () => {
    const { user } = mount(page([]));
    const reply = api.hold();
    await user.click(dash.chip("Confirmed"));
    expect(dash.empty()).toBe("Loading…");

    reply.open();
    await waitFor(() => expect(dash.names()).toEqual(NAMES));
    expect(dash.empty()).toBeNull();
  });

  it("keeps the stat numbers when one carries no counts", async () => {
    api.matching = () => [BOB];
    api.counts = {
      total: 1,
      pending: 0,
      confirmed: 1,
      cancelled: 0,
      deleted: 0,
    };
    const { user } = mount();
    await user.click(dash.chip("Confirmed"));
    await waitFor(() => expect(dash.names()).toEqual(["Bob Stone"]));
    expect(dash.stats()).toEqual(STATS);
  });

  it("ignores an older one that lands after a newer one", async () => {
    api.matching = (q) => ROWS.filter((r) => r.status === q.status);
    const { user } = mount();
    const older = api.hold();
    await user.click(dash.chip("Confirmed"));
    await user.click(dash.chip("Cancelled"));
    await waitFor(() => expect(dash.names()).toEqual(["Cy Young"]));
    await waitFor(() => expect(dash.busy()).toBe("false"));

    older.open();
    await settle();
    expect(dash.names()).toEqual(["Cy Young"]);
    expect(dash.busy()).toBe("false");
  });

  it("lets an older one end neither the wait nor the list of a newer one", async () => {
    api.matching = (q) => ROWS.filter((r) => r.status === q.status);
    const { user } = mount();
    const older = api.hold();
    const newer = api.hold();
    await user.click(dash.chip("Confirmed"));
    await user.click(dash.chip("Cancelled"));
    older.open();
    await settle();
    expect(dash.names()).toEqual(NAMES);
    expect(dash.busy()).toBe("true");

    newer.open();
    await waitFor(() => expect(dash.names()).toEqual(["Cy Young"]));
    await waitFor(() => expect(dash.busy()).toBe("false"));
  });

  it("steps back to the last page when the asked one is past the end", async () => {
    const { user } = mount(page(many(25), 60));
    api.matching = () => many(30);
    api.hold().open();
    const stepBack = api.hold();
    await user.click(dash.page("3"));
    await waitFor(() => expect(api.calls).toHaveLength(2));
    // The rows already on screen stay until the last page's own rows arrive.
    expect(dash.names()).toEqual(guests(1, 25));

    stepBack.open();
    await waitFor(() => expect(dash.info()).toBe("26-30 of 30"));
    expect(dash.names()).toEqual(guests(26, 30));
    expect(api.calls).toEqual([
      listed("all", { page: 3 }),
      listed("all", { page: 2 }),
    ]);
    expect(dash.pager()).toEqual(["‹ Prev", "1", "2", "Next ›"]);
    expect(dash.current()).toEqual(["2"]);
    expect(dash.page("Next page").disabled).toBe(true);
  });

  it("leaves the list as it was when the server refuses", async () => {
    api.refuses = true;
    const { user } = mount();
    const reply = api.hold();
    await user.click(dash.chip("Confirmed"));
    expect(dash.busy()).toBe("true");

    reply.open();
    await waitFor(() => expect(dash.busy()).toBe("false"));
    expect(dash.names()).toEqual(NAMES);
    expect(dash.stats()).toEqual(STATS);
  });

  for (const [how, failure] of [
    ["the connection drops", "drop"],
    ["the reply is not JSON", "html"],
  ] as const) {
    it(`ends the wait and keeps the rows when ${how}`, async () => {
      allowStrayRejection();
      api.listFails = failure;
      const { user } = mount();
      const reply = api.hold();
      await user.click(dash.chip("Confirmed"));
      expect(dash.busy()).toBe("true");

      reply.open();
      await waitFor(() => expect(dash.busy()).toBe("false"));
      expect(dash.info()).toBe("1-3 of 3");
      expect(dash.names()).toEqual(NAMES);
      expect(dash.stats()).toEqual(STATS);
    });
  }
});
