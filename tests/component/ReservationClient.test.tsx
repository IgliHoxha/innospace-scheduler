// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAYS,
  NOTE_DEMAND,
  fakeLayout,
  fakeServer,
  form,
  mountForm,
  reply,
} from "../helpers/dom";

vi.mock("next/script", () => ({ default: () => null }));
// Only what the screen hands it is of interest here; the menu has its own test.
vi.mock("@/components/Topbar", () => ({
  Topbar: (p: { username?: string; email?: string; signOutTo?: string }) => (
    <div data-testid="topbar">
      {[p.username, p.email, p.signOutTo].join("|")}
    </div>
  ),
}));
vi.mock("@/components/SiteFooter", () => ({ SiteFooter: () => null }));

const ADA = { name: "Ada Lovelace", email: "ada@example.com" };
const NAME_REASON = "Please enter your full name.";
const EMAIL_REASON = "Please enter your email.";

let server: ReturnType<typeof fakeServer>;
let rejections: unknown[];
const onRejection = (e: PromiseRejectionEvent) => rejections.push(e.reason);

beforeEach(() => {
  localStorage.clear();
  fakeLayout();
  server = fakeServer();
  rejections = [];
  window.addEventListener("unhandledrejection", onRejection);
});

afterEach(() => {
  window.removeEventListener("unhandledrejection", onRejection);
  cleanup();
  vi.unstubAllGlobals();
});

/** The form mounted with its first board in and the 09:00 pick seeded. */
async function ready() {
  const view = mountForm();
  await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));
  await waitFor(() => expect(form.reserve().disabled).toBe(false));
  return view;
}

type User = Awaited<ReturnType<typeof ready>>["user"];

async function fillGuest(user: User, who = ADA) {
  await user.type(form.name(), who.name);
  await user.type(form.email(), who.email);
}

const pickHour = (from: string, to: string) =>
  fireEvent.click(form.hour(from, to));

/** One booking of this browser's on booth 1, day 1, 14:00 to 15:00. */
function ownBooking() {
  const at = `${DAYS[0]}T14:00`;
  localStorage.setItem(
    "innospace.mine",
    JSON.stringify([
      {
        k: `booth-1|${at}`,
        s: at,
        e: `${DAYS[0]}T15:00`,
        m: ADA.email,
        t: "tok-14",
      },
    ]),
  );
  server.taken = (booth) =>
    booth === "booth-1" && server.cancels.length === 0
      ? [{ start: "14:00", end: "15:00", label: "Booked" }]
      : [];
}

describe("first load", () => {
  it("opens on a free hour of the first booth and day, ready to reserve", async () => {
    await ready();
    expect(server.gets).toEqual([
      { booth: "booth-1", date: DAYS[0], fresh: false },
    ]);
    expect(form.booth(1).className).toContain("active");
    expect(form.reserve().disabled).toBe(false);
    expect(form.alerts()).toEqual([]);
  });

  it("marks both name and email as required", async () => {
    await ready();
    const labels = [...document.querySelectorAll(".guest-field > span")];
    expect(labels.map((l) => l.textContent)).toEqual([
      "Full name *",
      "Email *",
    ]);
    for (const star of document.querySelectorAll(".guest-field b")) {
      expect(star.getAttribute("aria-hidden")).toBe("true");
    }
    expect(form.name().required && form.email().required).toBe(true);
  });
});

describe("name and email", () => {
  it("turns every failing field red on a refused press, and sends nothing", async () => {
    const { user } = await ready();
    await user.click(form.reserve());
    expect(form.isRed(form.name())).toBe(true);
    expect(form.isRed(form.email())).toBe(true);
    expect(server.posts).toEqual([]);
  });

  it("shows no visible alert for them", async () => {
    const { user } = await ready();
    await user.click(form.reserve());
    expect(form.alerts()).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("moves focus to the first failing field", async () => {
    const { user } = await ready();
    await user.click(form.reserve());
    expect(document.activeElement).toBe(form.name());
    await user.type(form.name(), ADA.name);
    await user.click(form.reserve());
    expect(document.activeElement).toBe(form.email());
  });

  // A reason rendered after the focus move is never read out.
  it("has the reason in the page by the time the field takes focus", async () => {
    const { user } = await ready();
    let heard = "";
    form.name().addEventListener("focus", () => {
      heard = form.reasonFor(form.name());
    });
    await user.click(form.reserve());
    expect(heard).toBe(NAME_REASON);
  });

  it("ties each red field to its own reason for a screen reader", async () => {
    const { user } = await ready();
    await user.click(form.reserve());
    expect(form.reasonFor(form.name())).toBe(NAME_REASON);
    expect(form.reasonFor(form.email())).toBe(EMAIL_REASON);
  });

  it("clears only the edited field's mark", async () => {
    const { user } = await ready();
    await user.click(form.reserve());
    await user.type(form.name(), "A");
    expect(form.isRed(form.name())).toBe(false);
    expect(form.reasonFor(form.name())).toBe("");
    expect(form.isRed(form.email())).toBe(true);
    expect(form.reasonFor(form.email())).toBe(EMAIL_REASON);
  });

  it("marks only the email when the name is fine", async () => {
    const { user } = await ready();
    await user.type(form.name(), ADA.name);
    await user.type(form.email(), "ada@example");
    await user.click(form.reserve());
    expect(form.isRed(form.name())).toBe(false);
    expect(form.isRed(form.email())).toBe(true);
    expect(form.reasonFor(form.email())).toBe(
      "Please enter a valid email address.",
    );
  });

  it("marks the field the server refuses, and moves focus there", async () => {
    for (const [refusal, field, other, reason] of [
      [reply.badEmail, form.email, form.name, "That domain takes no mail."],
      [reply.badName, form.name, form.email, "Please enter your name."],
    ] as const) {
      const { user } = await ready();
      await fillGuest(user);
      server.replies.push(refusal);
      await user.click(form.reserve());
      await waitFor(() => expect(form.isRed(field())).toBe(true));
      expect(form.reasonFor(field())).toBe(reason);
      expect(form.isRed(other())).toBe(false);
      expect(document.activeElement).toBe(field());
      expect(form.alerts()).toEqual([]);
      cleanup();
    }
  });

  it("clears a mark the server set once the next press goes through", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.badEmail);
    await user.click(form.reserve());
    await waitFor(() => expect(form.isRed(form.email())).toBe(true));
    await user.click(form.reserve());
    await waitFor(() => expect(form.banner()).toContain("Reserved Booth 1"));
    expect(form.isRed(form.email())).toBe(false);
  });
});

describe("the note", () => {
  it("is optional for an ordinary booking", async () => {
    await ready();
    expect(form.noteRequired()).toBe(false);
    expect(form.note().getAttribute("aria-invalid")).toBe("false");
  });

  it("is asked for by the form itself at two hours, without a request", async () => {
    const { user } = await ready();
    await fillGuest(user);
    await user.click(document.getElementById("end-hours")!);
    await user.keyboard("{ArrowUp}");
    expect(form.pick()).toBe("09:00-11:00");
    expect(form.noteRequired()).toBe(true);
    expect(form.alerts()).toEqual([]);

    await user.click(form.reserve());
    expect(server.posts).toEqual([]);
    expect(form.alerts()).toHaveLength(1);
    expect(form.alerts()[0]).toContain("a note is required for 2 hours");
    expect(document.activeElement).toBe(form.note());
  });

  it("has its prompt in the page by the time the box takes focus", async () => {
    const { user } = await ready();
    await fillGuest(user);
    let heard = "";
    form.note().addEventListener("focus", () => {
      heard = form.reasonFor(form.note());
    });
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(heard).toBe(NOTE_DEMAND));
  });

  it("links its prompt to the box for a screen reader", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(form.alerts()).toEqual([NOTE_DEMAND]));
    expect(form.note().getAttribute("aria-invalid")).toBe("true");
    expect(form.reasonFor(form.note())).toBe(NOTE_DEMAND);

    await user.type(form.note(), "x");
    expect(form.note().getAttribute("aria-invalid")).toBe("false");
    expect(form.note().hasAttribute("aria-describedby")).toBe(false);
  });

  it("stays required through typing and clearing once the server asks", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(form.noteRequired()).toBe(true));
    expect(form.note().className).toBe("note-box required");
    expect(document.activeElement).toBe(form.note());

    await user.type(form.note(), "x");
    expect(form.noteRequired()).toBe(true);
    expect(form.alerts()).toEqual([]);
    expect(form.note().className.trim()).toBe("note-box");

    await user.clear(form.note());
    expect(form.noteRequired()).toBe(true);
    expect(form.alerts()).toEqual([NOTE_DEMAND]);
  });

  it("does not send the refused attempt again while the note is empty", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(form.noteRequired()).toBe(true));
    await user.click(form.reserve());
    await user.type(form.note(), "   ");
    await user.click(form.reserve());
    expect(server.posts).toHaveLength(1);

    await user.clear(form.note());
    await user.type(form.note(), "client call");
    await user.click(form.reserve());
    await waitFor(() => expect(server.posts).toHaveLength(2));
    expect(server.posts[1].note).toBe("client call");
  });

  it("lapses when the pick changes and returns with it, for every pick asked about", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.noteDemand, reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(form.noteRequired()).toBe(true));

    pickHour("12:00", "13:00");
    expect(form.noteRequired()).toBe(false);
    expect(form.alerts()).toEqual([]);
    await user.click(form.reserve());
    await waitFor(() => expect(form.alerts()).toEqual([NOTE_DEMAND]));

    pickHour("09:00", "10:00");
    expect(form.noteRequired()).toBe(true);
    expect(form.alerts()).toEqual([NOTE_DEMAND]);
    pickHour("12:00", "13:00");
    expect(form.alerts()).toEqual([NOTE_DEMAND]);
    await user.click(form.reserve());
    expect(server.posts).toHaveLength(2);
  });

  it("lapses for another booker and returns for the first", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(form.noteRequired()).toBe(true));

    await user.clear(form.email());
    await user.type(form.email(), "bob@example.com");
    expect(form.noteRequired()).toBe(false);
    await user.clear(form.email());
    await user.type(form.email(), "ADA@Example.com");
    expect(form.noteRequired()).toBe(true);
  });

  it("treats a fault in the note's text as an error, not a demand", async () => {
    const { user } = await ready();
    await fillGuest(user);
    await user.type(form.note(), "long");
    server.replies.push({
      status: 400,
      body: { ok: false, field: "note", error: "The note is too long." },
    });
    await user.click(form.reserve());
    await waitFor(() =>
      expect(form.alerts()).toEqual(["The note is too long."]),
    );
    expect(form.noteRequired()).toBe(false);
    expect(document.activeElement).toBe(form.note());
  });
});

describe("a refused pick", () => {
  it("shows why and switches Reserve off for that pick alone", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.clash);
    await user.click(form.reserve());
    await waitFor(() =>
      expect(form.alerts()).toEqual(["That overlaps an existing reservation."]),
    );
    expect(form.reserve().disabled).toBe(true);

    pickHour("12:00", "13:00");
    expect(form.alerts()).toEqual([]);
    expect(form.reserve().disabled).toBe(false);
    pickHour("09:00", "10:00");
    expect(form.reserve().disabled).toBe(true);
  });

  it("leaves Reserve usable after a refusal that is not about the pick", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.throttled);
    await user.click(form.reserve());
    await waitFor(() =>
      expect(form.alerts()).toEqual([
        "Too many reservations. Try again later.",
      ]),
    );
    expect(form.reserve().disabled).toBe(false);
  });

  it("says so when the server cannot be reached", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.postFails = true;
    await user.click(form.reserve());
    await waitFor(() =>
      expect(form.alerts()).toEqual([
        "Could not reach the server. Please try again.",
      ]),
    );
    expect(form.reserve().disabled).toBe(false);
    expect(form.reserve().textContent).toBe("Reserve");
    expect(rejections).toEqual([]);

    server.postFails = false;
    await user.click(form.reserve());
    await waitFor(() => expect(form.banner()).toContain("Reserved Booth 1"));
  });
});

describe("a booking that goes through", () => {
  it("sends the slot and the booker, confirms, and starts over", async () => {
    const { user } = await ready();
    await fillGuest(user, {
      name: "  Ada   Lovelace ",
      email: "Ada@Example.com",
    });
    await user.type(form.note(), "client call");
    server.taken = () =>
      server.posts.length
        ? [{ start: "09:00", end: "10:00", label: "Booked" }]
        : [];
    await user.click(form.reserve());
    await waitFor(() => expect(form.banner()).not.toBe(""));

    expect(server.posts).toEqual([
      {
        boothId: "booth-1",
        date: DAYS[0],
        start: "09:00",
        end: "10:00",
        note: "client call",
        turnstileToken: "",
        fullName: "Ada Lovelace",
        email: "ada@example.com",
      },
    ]);
    expect(form.banner()).toBe(
      "Reserved Booth 1 on Thursday, 16 July 2026, 09:00 - 10:00. We've emailed ada@example.com a confirmation, with a link to cancel if your plans change.",
    );
    expect(form.note().value).toBe("");
    await waitFor(() => expect(form.pick()).toBe("10:00-11:00"));
    expect(server.gets.at(-1)).toMatchObject({ booth: "booth-1", fresh: true });
    expect(document.querySelector(".daycal-block.mine")?.textContent).toContain(
      "You",
    );
  });

  it("keeps Reserve off until the board is back, so the slot cannot be sent twice", async () => {
    const { user } = await ready();
    await fillGuest(user);
    const post = server.holdPost();
    await user.click(form.reserve());
    const board = server.holdBoard();
    post.open();
    await waitFor(() => expect(form.banner()).not.toBe(""));
    expect(form.reserve().disabled).toBe(true);
    board.open();
    await waitFor(() => expect(form.reserve().disabled).toBe(false));
  });

  it("words a booking that waits for approval differently", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push((b) => reply.booked(b, "pending"));
    await user.click(form.reserve());
    await waitFor(() =>
      expect(form.banner()).toContain("Request submitted: Booth 1"),
    );
  });

  it("forgets earlier refusals", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(form.noteRequired()).toBe(true));
    pickHour("12:00", "13:00");
    await user.click(form.reserve());
    await waitFor(() => expect(form.banner()).not.toBe(""));
    await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));
    expect(form.noteRequired()).toBe(false);
  });
});

describe("switching booth or day", () => {
  it("clears the red fields, the note prompt and any banner", async () => {
    const { user } = await ready();
    await user.click(form.reserve());
    expect(form.isRed(form.name())).toBe(true);
    await user.click(form.booth(2));
    expect(form.isRed(form.name())).toBe(false);
    expect(form.isRed(form.email())).toBe(false);
    expect(form.reasonFor(form.name())).toBe("");
    await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));

    await fillGuest(user);
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(form.alerts()).toEqual([NOTE_DEMAND]));
    await user.click(form.day(2));
    expect(form.alerts()).toEqual([]);
    expect(form.noteRequired()).toBe(false);
  });

  it("keeps what was typed", async () => {
    const { user } = await ready();
    await fillGuest(user);
    await user.type(form.note(), "my note");
    await user.click(form.booth(3));
    await user.click(form.day(3));
    expect(form.name().value).toBe(ADA.name);
    expect(form.email().value).toBe(ADA.email);
    expect(form.note().value).toBe("my note");
  });

  it("drops the pick at once, so Reserve waits for the new board", async () => {
    const { user } = await ready();
    pickHour("14:00", "15:00");
    const board = server.holdBoard();
    await user.click(form.booth(2));
    expect(form.timeCard()).toContain("Loading availability");
    expect(form.reserve().disabled).toBe(true);

    server.taken = () => [{ start: "09:00", end: "10:00", label: "Booked" }];
    board.open();
    await waitFor(() => expect(form.pick()).toBe("10:00-11:00"));
    await waitFor(() => expect(form.reserve().disabled).toBe(false));
    expect(server.gets.at(-1)).toMatchObject({ booth: "booth-2" });
  });

  it("forgets a note the server asked for on the board left behind", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(form.noteRequired()).toBe(true));
    await user.click(form.booth(2));
    await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));
    await user.click(form.booth(1));
    await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));
    expect(form.noteRequired()).toBe(false);
    expect(form.alerts()).toEqual([]);
  });
});

describe("a reply that lands after the form moved on", () => {
  const FAILED =
    "Booth 1 on Thursday, 16 July 2026, 09:00 - 10:00 was not reserved.";

  it("names the booking that failed and marks nothing on the new board", async () => {
    for (const refusal of [reply.clash, reply.noteDemand, reply.badEmail]) {
      const { user } = await ready();
      await fillGuest(user);
      const post = server.holdPost();
      server.replies.push(refusal);
      await user.click(form.reserve());
      await user.click(form.booth(2));
      post.open();
      await waitFor(() => expect(form.alerts()).toHaveLength(1));
      expect(form.alerts()[0]).toBe(`${FAILED} ${refusal.body.error}`);
      expect(form.isRed(form.email())).toBe(false);
      expect(form.noteRequired()).toBe(false);
      expect(document.activeElement).not.toBe(form.note());
      expect(document.activeElement).not.toBe(form.email());
      await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));
      expect(server.gets.at(-1)).toMatchObject({ booth: "booth-2" });
      cleanup();
    }
  });

  it("does the same when only the pick changed, and still remembers the verdict", async () => {
    const { user } = await ready();
    await fillGuest(user);
    const post = server.holdPost();
    server.replies.push(reply.clash);
    await user.click(form.reserve());
    pickHour("12:00", "13:00");
    post.open();
    await waitFor(() =>
      expect(form.alerts()).toEqual([
        `${FAILED} That overlaps an existing reservation.`,
      ]),
    );
    expect(form.reserve().disabled).toBe(false);
    pickHour("09:00", "10:00");
    expect(form.reserve().disabled).toBe(true);
  });

  it("does not mark an email corrected while the request was out", async () => {
    const { user } = await ready();
    await fillGuest(user, { name: ADA.name, email: "ada@exmaple.cm" });
    const post = server.holdPost();
    server.replies.push(reply.badEmail);
    await user.click(form.reserve());
    await user.clear(form.email());
    await user.type(form.email(), ADA.email);
    post.open();
    await waitFor(() => expect(form.alerts()).toHaveLength(1));
    expect(form.isRed(form.email())).toBe(false);
  });
});

describe("focus when a refusal arrives", () => {
  it("goes to the field it names while the user is idle", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(document.activeElement).toBe(form.note()));
  });

  it("is not pulled out of a field the user has moved into", async () => {
    const { user } = await ready();
    await fillGuest(user);
    const post = server.holdPost();
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await user.click(form.name());
    post.open();
    await waitFor(() => expect(form.alerts()).toEqual([NOTE_DEMAND]));
    expect(document.activeElement).toBe(form.name());
    await user.keyboard(" King");
    expect(form.name().value).toBe("Ada Lovelace King");
    expect(form.note().value).toBe("");
  });
});

describe("the board itself", () => {
  it("says so and offers a retry when it cannot be loaded", async () => {
    for (const failure of ["drop", "html"] as const) {
      server.boardFails = failure;
      const { user } = mountForm();
      await waitFor(() =>
        expect(form.timeCard()).toContain("Couldn't load availability."),
      );
      expect(form.reserve().disabled).toBe(true);
      expect(rejections).toEqual([]);

      server.boardFails = null;
      await user.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));
      await waitFor(() => expect(form.reserve().disabled).toBe(false));
      cleanup();
    }
  });

  it("does not leave the old board up when a refresh fails", async () => {
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.throttled);
    server.boardFails = "drop";
    await user.click(form.reserve());
    await waitFor(() =>
      expect(form.timeCard()).toContain("Couldn't load availability."),
    );
    expect(form.reserve().disabled).toBe(true);
    expect(rejections).toEqual([]);
  });

  it("refreshes in place after a refusal, keeping the pick and the fields", async () => {
    const { user } = await ready();
    await fillGuest(user);
    pickHour("14:00", "15:00");
    const startField = document.getElementById("start-hours");
    server.replies.push(reply.throttled);
    await user.click(form.reserve());
    await waitFor(() => expect(form.alerts()).toHaveLength(1));

    const board = server.holdBoard();
    server.replies.push(reply.throttled);
    await user.click(form.reserve());
    await waitFor(() => expect(server.gets).toHaveLength(3));
    expect(form.timeCard()).not.toContain("Loading availability");
    expect(document.getElementById("start-hours")).toBe(startField);
    board.open();
    await waitFor(() => expect(server.gets.at(-1)?.fresh).toBe(true));
    expect(form.pick()).toBe("14:00-15:00");
    expect(document.getElementById("start-hours")).toBe(startField);
  });

  it("keeps an open cancel dialog through that refresh", async () => {
    ownBooking();
    const { user } = await ready();
    await fillGuest(user);
    const post = server.holdPost();
    server.replies.push(reply.clash);
    await user.click(form.reserve());
    fireEvent.click(document.querySelector(".daycal-block.can-cancel")!);
    const dialog = screen.getByRole("dialog", {
      name: "Cancel this reservation",
    });
    post.open();
    await waitFor(() => expect(server.gets).toHaveLength(2));
    await waitFor(() => expect(form.alerts()).toHaveLength(1));
    expect(
      screen.getByRole("dialog", { name: "Cancel this reservation" }),
    ).toBe(dialog);
  });
});

// Google sign-in is optional: a guest books as before, a member types nothing.
describe("signed in with Google", () => {
  const member = { name: "Ada Lovelace", email: "ada@example.com" };
  const labels = () =>
    [...document.querySelectorAll(".field-label")].map((l) => l.textContent);
  const repeat = () =>
    document.getElementById("repeatWeeks") as HTMLSelectElement | null;

  async function readyAsMember(props = {}) {
    server.member = member;
    const view = mountForm({ maxRepeatWeeks: 8, ...props });
    await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));
    await waitFor(() => expect(form.reserve().disabled).toBe(false));
    return view;
  }

  it("drops the details card and names the booker in the top bar instead", async () => {
    await readyAsMember();
    expect(form.name()).toBeNull();
    expect(form.email()).toBeNull();
    expect(labels()).not.toContain("Your details");
    expect(labels()).toContain("Repeat");
    expect(document.body.textContent).not.toContain("Sign in with Google");
    // The menu on the right carries the name, the address and the way out.
    expect(screen.getByTestId("topbar").textContent).toBe(
      "Ada Lovelace|ada@example.com|/",
    );
    expect(
      screen.queryByRole("link", { name: "Sign in with Google" }),
    ).toBeNull();
  });

  it("books with no name or email in the body: the session carries them", async () => {
    const { user } = await readyAsMember();
    await user.click(form.reserve());
    await waitFor(() => expect(form.banner()).not.toBe(""));
    expect(server.posts).toEqual([
      {
        boothId: "booth-1",
        date: DAYS[0],
        start: "09:00",
        end: "10:00",
        note: "",
        turnstileToken: "",
      },
    ]);
    expect(form.banner()).toContain("We've emailed ada@example.com");
  });

  it("offers a weekly repeat, says so in the summary, and sends the count", async () => {
    const { user } = await readyAsMember();
    expect(repeat()?.value).toBe("1");
    expect([...repeat()!.options].map((o) => o.textContent)).toEqual([
      "Just this once",
      ...[2, 3, 4, 5, 6, 7, 8].map((n) => `Every week for ${n} weeks`),
    ]);
    await user.selectOptions(repeat()!, "3");
    expect(document.querySelector(".reserve-summary")?.textContent).toContain(
      "every week for 3 weeks",
    );

    server.otherwise = (b) => ({
      status: 201,
      body: {
        ok: true,
        reservation: {
          id: "r1",
          status: "confirmed",
          boothId: b.boothId,
          startsAt: `${b.date}T${b.start}`,
          endsAt: `${b.date}T${b.end}`,
        },
        reservations: [
          {
            id: "r1",
            startsAt: `${DAYS[0]}T09:00`,
            endsAt: `${DAYS[0]}T10:00`,
            cancelToken: "tok-1",
          },
          {
            id: "r2",
            startsAt: `2026-07-23T09:00`,
            endsAt: `2026-07-23T10:00`,
            cancelToken: "tok-2",
          },
          {
            id: "r3",
            startsAt: `2026-07-30T09:00`,
            endsAt: `2026-07-30T10:00`,
            cancelToken: "tok-3",
          },
        ],
      },
    });
    await user.click(form.reserve());
    await waitFor(() => expect(form.banner()).not.toBe(""));
    expect(server.posts[0]).toMatchObject({ repeatWeeks: 3 });
    expect(form.banner()).toBe(
      "Reserved Booth 1 on Thursday, 16 July 2026, 09:00 - 10:00, every week for 3 weeks. We've emailed ada@example.com a confirmation, with a link to cancel if your plans change.",
    );
    // Every date is remembered as this browser's, with its own cancel token.
    const mine = JSON.parse(localStorage.getItem("innospace.mine") ?? "[]");
    expect(mine.map((m: { k: string; t: string }) => [m.k, m.t])).toEqual([
      ["booth-1|2026-07-30T09:00", "tok-3"],
      ["booth-1|2026-07-23T09:00", "tok-2"],
      [`booth-1|${DAYS[0]}T09:00`, "tok-1"],
    ]);
    // Back to a single booking, so the next press cannot repeat by accident.
    expect(repeat()?.value).toBe("1");
  });

  it("sends no count for a single booking", async () => {
    const { user } = await readyAsMember();
    await user.click(form.reserve());
    await waitFor(() => expect(form.banner()).not.toBe(""));
    expect(server.posts[0]).not.toHaveProperty("repeatWeeks");
  });

  it("lets a refusal of a repeat expire when the count changes", async () => {
    const { user } = await readyAsMember();
    await user.selectOptions(repeat()!, "2");
    server.replies.push({
      status: 409,
      body: {
        ok: false,
        error: "Thursday, 23 July 2026: That time slot is no longer available.",
      },
    });
    await user.click(form.reserve());
    await waitFor(() =>
      expect(form.alerts()).toEqual([
        "Thursday, 23 July 2026: That time slot is no longer available.",
      ]),
    );
    expect(form.reserve().disabled).toBe(true);
    await user.selectOptions(repeat()!, "1");
    expect(form.alerts()).toEqual([]);
    expect(form.reserve().disabled).toBe(false);
  });

  it("gives a guest no menu in the top bar", async () => {
    await ready();
    expect(screen.getByTestId("topbar").textContent).toBe("||/");
  });

  // Google vouched for them, so the Cloudflare widget never loads.
  it("skips the bot check: no widget, and Reserve is not held up for a token", async () => {
    const { user } = await readyAsMember({ turnstileSiteKey: "site-key" });
    expect(document.querySelector(".turnstile-slot")).toBeNull();
    await user.click(form.reserve());
    await waitFor(() => expect(form.banner()).not.toBe(""));
    expect(form.alerts()).toEqual([]);
    expect(server.posts).toHaveLength(1);
  });

  // The page is cached at the edge for everyone, so only this call may say who.
  it("learns who is signed in from /api/me, asked once and never cached", async () => {
    await readyAsMember();
    expect(server.whoAsked).toBe(1);
    const call = vi
      .mocked(fetch)
      .mock.calls.find(([u]) => String(u) === "/api/me");
    expect(call?.[1]).toMatchObject({ cache: "no-store" });
  });

  it("books as a guest when /api/me cannot be reached", async () => {
    server.member = member;
    server.meFails = true;
    mountForm({ maxRepeatWeeks: 8 });
    await waitFor(() => expect(form.name()).not.toBeNull());
    expect(screen.getByTestId("topbar").textContent).toBe("||/");
    expect(repeat()).toBeNull();
  });

  it("shows no card at all when only one week is allowed", async () => {
    await readyAsMember({ maxRepeatWeeks: 1 });
    expect(repeat()).toBeNull();
    expect(labels()).not.toContain("Repeat");
    expect(document.querySelector(".guest-card")).toBeNull();
  });
});

describe("a guest offered Google sign-in", () => {
  it("sees the link only when sign-in is configured, beside the usual fields", async () => {
    mountForm({ googleSignIn: true });
    await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));
    const link = screen.getByRole("link", { name: "Sign in with Google" });
    expect(link.getAttribute("href")).toBe("/api/auth/google");
    expect(form.name()).toBeTruthy();
    expect(form.email()).toBeTruthy();
    expect(document.getElementById("repeatWeeks")).toBeNull();
  });

  it("still faces the bot check as a guest, and is told to complete it", async () => {
    mountForm({ turnstileSiteKey: "site-key" });
    await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));
    expect(document.querySelector(".turnstile-slot")).not.toBeNull();
    const user = (await import("@testing-library/user-event")).default.setup();
    await fillGuest(user);
    await user.click(form.reserve());
    expect(form.alerts()).toEqual([
      "Please complete the human check below, then reserve again.",
    ]);
    expect(server.posts).toEqual([]);
  });

  it("sees no link while sign-in is off", async () => {
    await ready();
    expect(
      screen.queryByRole("link", { name: "Sign in with Google" }),
    ).toBeNull();
  });

  it("is told when Google sent them back without a session, and can still book", async () => {
    mountForm({ googleSignIn: true, signInFailed: true });
    await waitFor(() => expect(form.pick()).toBe("09:00-10:00"));
    expect(form.alerts()).toEqual([
      "Google sign-in didn't complete. You can still book as a guest below.",
    ]);
    const user = (await import("@testing-library/user-event")).default.setup();
    await fillGuest(user);
    await user.click(form.reserve());
    await waitFor(() => expect(form.banner()).not.toBe(""));
    expect(form.alerts()).toEqual([]);
    expect(server.posts).toHaveLength(1);
  });
});

describe("cancelling from the board", () => {
  it("frees the slot, says so, and forgets what the server had asked", async () => {
    ownBooking();
    const { user } = await ready();
    await fillGuest(user);
    server.replies.push(reply.noteDemand);
    await user.click(form.reserve());
    await waitFor(() => expect(form.noteRequired()).toBe(true));

    fireEvent.click(document.querySelector(".daycal-block.can-cancel")!);
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    await waitFor(() =>
      expect(form.banner()).toContain("Your reservation is cancelled."),
    );
    expect(server.cancels).toEqual([{ token: "tok-14" }]);
    expect(form.noteRequired()).toBe(false);
    expect(form.alerts()).toEqual([]);
    await waitFor(() =>
      expect(document.querySelector(".daycal-block")).toBeNull(),
    );
    expect(form.pick()).toBe("09:00-10:00");
  });
});
