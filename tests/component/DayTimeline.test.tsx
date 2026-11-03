// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DayTimeline from "@/app/DayTimeline";
import { fakeLayout } from "../helpers/dom";

type Props = ComponentProps<typeof DayTimeline>;

const CONTACT = { phone: "+355 00 000", email: "hello@test.test" };
// The widths Chromium measures at the designed text size.
const DESIGNED = { bar: 1126, tick: 27, tag: 71, tagText: 71 };

function mount(props: Partial<Props> = {}) {
  return render(
    <DayTimeline
      earliest="00:00"
      reserved={[]}
      selection={null}
      step={5}
      minMinutes={15}
      contact={CONTACT}
      {...props}
    />,
  );
}

const marks = () =>
  [...document.querySelectorAll(".daycal-ticks > .daycal-tick")].map(
    (t) => t.textContent,
  );
const tag = () =>
  document.querySelector<HTMLElement>(
    ".daycal-plot > .daycal-pick-tag:not(.daycal-sizer)",
  )!;
const stripAbove = () =>
  document.querySelector(".daycal-pick-tag.above.daycal-sizer");
const blocks = () => [
  ...document.querySelectorAll<HTMLButtonElement>(".daycal-block"),
];
const hour = (from: string, to: string) =>
  document.querySelector<HTMLButtonElement>(
    `.daycal-cell[aria-label="Reserve ${from} to ${to}"]`,
  )!;

let layout: ReturnType<typeof fakeLayout>;

beforeEach(() => {
  layout = fakeLayout(DESIGNED);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("hour marks", () => {
  it("labels every other hour on a desktop bar at the designed text size", () => {
    mount();
    expect(marks()).toEqual([
      "00:00",
      "02:00",
      "04:00",
      "06:00",
      "08:00",
      "10:00",
      "12:00",
      "14:00",
      "16:00",
      "18:00",
      "20:00",
      "22:00",
      "24:00",
    ]);
  });

  it("labels every hour before anything is measured", () => {
    fakeLayout();
    mount();
    expect(marks()).toHaveLength(25);
  });

  // 60px text needs 97px a mark; without the 7px gap it would still fit thirteen.
  it("thins by the measured label width plus a clear gap", () => {
    layout.resize({ tick: 60 });
    mount();
    expect(marks()).toHaveLength(9);
  });

  // Floor and gap swapped would ask 89px a mark here and label only seven.
  it("keeps the designed room at the designed size on a narrower bar", () => {
    layout.resize({ bar: 600 });
    mount();
    expect(marks()).toHaveLength(13);
  });

  it("re-thins when the label alone grows, as text zoom does", () => {
    mount();
    expect(marks()).toHaveLength(13);
    layout.resize({ tick: 108 });
    expect(marks()).toEqual([
      "00:00",
      "04:00",
      "08:00",
      "12:00",
      "16:00",
      "20:00",
      "24:00",
    ]);
  });

  it("re-thins when the bar narrows", () => {
    mount();
    layout.resize({ bar: 246 });
    expect(marks()).toEqual(["00:00", "06:00", "12:00", "18:00", "24:00"]);
  });

  it("keeps only the first mark when even the two ends would touch", () => {
    layout.resize({ bar: 246, tick: 122 });
    mount();
    expect(marks()).toEqual(["00:00"]);
  });

  it("measures every hour's label, not one that stands for them all", () => {
    mount();
    const sizer = document.querySelector(".daycal-tick-sizer")!;
    expect([...sizer.children].map((c) => c.textContent)).toHaveLength(25);
    expect(sizer.children[24].textContent).toBe("24:00");
    expect(sizer.children[0].className).toBe("daycal-tick");
  });
});

describe("the pick's tag", () => {
  it("sits inside a pick wide enough to hold it", () => {
    mount({ selection: { start: "06:00", end: "18:00" } });
    expect(tag().className).toBe("daycal-pick-tag over");
    expect(tag().textContent).toBe("06:00 - 18:00");
    expect(stripAbove()).toBeNull();
  });

  it("floats above a narrow pick, in a strip made for it", () => {
    mount({ selection: { start: "19:00", end: "20:00" } });
    expect(tag().className).toBe("daycal-pick-tag above");
    expect(stripAbove()).not.toBeNull();
  });

  // A 110px pick holds the 71px tag; at 100px of text it no longer does.
  it("floats sooner once its own text has grown", () => {
    mount({ selection: { start: "10:00", end: "12:20" } });
    expect(tag().className).toBe("daycal-pick-tag over");
    layout.resize({ tag: 100, tagText: 100 });
    expect(tag().className).toBe("daycal-pick-tag above");
    expect(stripAbove()).not.toBeNull();
  });

  // Floating adds padding, which a content-box observer never reports.
  it("is measured by its border box", () => {
    mount({ selection: { start: "19:00", end: "20:00" } });
    expect(layout.boxWatched(tag())).toBe("border-box");
  });

  it("is clamped inside the bar at the end of the day", () => {
    layout.resize({ tag: 85 });
    mount({ selection: { start: "23:00", end: "23:55" } });
    expect(tag().style.left).toBe("1041px");
  });

  it("starts at the bar's left edge when it is wider than the bar", () => {
    layout.resize({ bar: 246, tag: 298, tagText: 284 });
    mount({ selection: { start: "23:00", end: "23:55" } });
    expect(tag().style.left).toBe("0px");
  });

  it("has no tag without a pick", () => {
    mount();
    expect(tag()).toBeNull();
  });
});

describe("the unseen sizers", () => {
  it("are hidden from assistive technology", () => {
    mount({ selection: { start: "19:00", end: "20:00" } });
    const sizers = document.querySelectorAll(
      ".daycal-sizer, .daycal-tick-sizer",
    );
    expect(sizers).toHaveLength(4);
    for (const s of sizers) expect(s.getAttribute("aria-hidden")).toBe("true");
  });

  // A stylesheet keyed on element type must reach a sizer exactly as it reaches the real thing.
  it("mirror the element they stand for", () => {
    mount({
      selection: { start: "19:00", end: "20:00" },
      reserved: [
        { start: "02:00", end: "05:00", label: "Booked", mine: false },
      ],
    });
    const shape = (el: Element) =>
      `${el.tagName}>${el.firstElementChild?.tagName ?? "text"}`;
    for (const s of document.querySelectorAll(
      ".daycal-pick-tag.daycal-sizer",
    )) {
      expect(shape(s)).toBe(shape(tag()));
    }
    const label = document.querySelector(".daycal-block .daycal-block-label")!;
    const labelSizer = document.querySelector(
      ".daycal-block-label.daycal-sizer",
    )!;
    expect(labelSizer.tagName).toBe(label.tagName);
  });
});

describe("picking by the hour", () => {
  it("hands back the hour a free box stands for", () => {
    const onPick = vi.fn();
    mount({ onPick });
    fireEvent.click(hour("12:00", "13:00"));
    expect(onPick).toHaveBeenCalledWith("12:00", "13:00");
  });

  it("stops the last hour a step short of midnight", () => {
    const onPick = vi.fn();
    mount({ onPick });
    fireEvent.click(hour("23:00", "23:55"));
    expect(onPick).toHaveBeenCalledWith("23:00", "23:55");
  });

  it("switches off an hour that is taken or already passed", () => {
    mount({
      onPick: vi.fn(),
      earliest: "08:20",
      reserved: [
        { start: "12:30", end: "13:00", label: "Booked", mine: false },
      ],
    });
    expect(hour("07:00", "08:00").disabled).toBe(true);
    expect(hour("08:00", "09:00").disabled).toBe(true);
    expect(hour("12:00", "13:00").disabled).toBe(true);
    expect(hour("09:00", "10:00").disabled).toBe(false);
  });

  it("draws no hour boxes on a read-only graph", () => {
    mount();
    expect(document.querySelector(".daycal-cell")).toBeNull();
  });
});

describe("bookings on the bar", () => {
  const theirs = { start: "02:00", end: "05:00", label: "Booked", mine: false };
  const ours = {
    start: "14:00",
    end: "15:00",
    label: "Booked",
    mine: true,
    cancelToken: "tok-14",
  };

  it("labels each as yours or booked", () => {
    mount({ reserved: [theirs, ours] });
    const labels = blocks().map(
      (b) => b.querySelector(".daycal-block-label:not(.on-hover)")?.textContent,
    );
    expect(labels).toEqual(["Booked", "You"]);
    expect(blocks()[1].className).toContain("can-cancel");
  });

  it("says in its tooltip whose booking it is and what a click does", () => {
    const legacy = { ...ours, start: "08:00", end: "09:30", cancelToken: "" };
    const tipOf = (block: HTMLElement) => {
      fireEvent.pointerEnter(block);
      const text = document.querySelector('[role="tooltip"]')?.textContent;
      fireEvent.pointerLeave(block);
      return text;
    };
    mount({ reserved: [theirs, legacy, ours] });
    expect(blocks().map(tipOf)).toEqual([
      "02:00 - 05:00 \u00b7 Booked - click to request information",
      "Your booking, 08:00 - 09:30 \u00b7 click to contact us about it",
      "Your booking, 14:00 - 15:00 \u00b7 click to cancel it",
    ]);
    cleanup();
    mount({ reserved: [theirs, legacy, ours], contact: undefined });
    expect(blocks().map(tipOf)).toEqual([
      "02:00 - 05:00 \u00b7 Booked",
      "Your booking, 08:00 - 09:30",
      "Your booking, 14:00 - 15:00 \u00b7 click to cancel it",
    ]);
  });

  it("offers to get in touch about somebody else's", async () => {
    mount({ reserved: [theirs] });
    await userEvent.click(blocks()[0]);
    expect(
      screen.getByRole("dialog", { name: "Get in touch about this booking" }),
    ).toBeTruthy();
  });

  it("leaves somebody else's inert when there is nowhere to send an enquiry", () => {
    mount({ reserved: [theirs], contact: undefined });
    expect(blocks()[0].disabled).toBe(true);
  });

  it("cancels your own after a confirmation, then tells the parent", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onCancelled = vi.fn();
    mount({ reserved: [ours], onCancelled });
    await userEvent.click(blocks()[0]);
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, cancel it" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "tok-14" }),
      }),
    );
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog open and says why when the cancel fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const onCancelled = vi.fn();
    mount({ reserved: [ours], onCancelled });
    await userEvent.click(blocks()[0]);
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, cancel it" }),
    );
    expect(
      screen.getByText("Could not reach the server. Please try again."),
    ).toBeTruthy();
    expect(onCancelled).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes the dialog on Escape or Keep it, cancelling nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mount({ reserved: [ours] });
    await userEvent.click(blocks()[0]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(blocks()[0]);
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("addresses both enquiry links to the contact, naming the booth, day and slot", async () => {
    mount({ reserved: [theirs] });
    await userEvent.click(blocks()[0]);
    const dialog = screen.getByRole("dialog", {
      name: "Get in touch about this booking",
    });
    const message =
      "Hi, I'd like to ask about the booth booking on that day, 02:00 - 05:00.";
    const subject = "Booking enquiry: booth, that day 02:00 - 05:00";
    const [email, whatsapp] = [...dialog.querySelectorAll("a")];
    expect(email.getAttribute("href")).toBe(
      `mailto:hello@test.test?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
    );
    expect(email.getAttribute("target")).toBeNull();
    expect(whatsapp.getAttribute("href")).toBe(
      `https://wa.me/35500000?text=${encodeURIComponent(message)}`,
    );
    expect(whatsapp.getAttribute("target")).toBe("_blank");
    expect(whatsapp.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("words the enquiry around the booth and day it was given", async () => {
    mount({
      reserved: [theirs],
      boothName: "Booth 2",
      dateLabel: "Tue, 5 Aug",
    });
    await userEvent.click(blocks()[0]);
    const dialog = screen.getByRole("dialog", {
      name: "Get in touch about this booking",
    });
    expect(dialog.className).toBe("modal ask-modal");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.parentElement?.className).toBe("modal-overlay");
    expect(dialog.parentElement?.getAttribute("role")).toBe("presentation");
    expect(dialog.querySelector("h2")?.textContent).toBe("Get in touch");
    expect(dialog.querySelector(".modal-sub")?.textContent).toBe(
      "Choose how you'd like to reach us about Booth 2 on Tue, 5 Aug, 02:00 - 05:00:",
    );
    const links = [...dialog.querySelectorAll(".ask-actions > a")];
    expect(links.map((a) => a.className)).toEqual(["btn", "btn whatsapp"]);
    expect(links.map((a) => a.textContent)).toEqual([" Email", " WhatsApp"]);
    expect(links[0].getAttribute("href")).toContain(
      encodeURIComponent("Booking enquiry: Booth 2, Tue, 5 Aug 02:00 - 05:00"),
    );
  });

  it("closes the enquiry from its close button or its backdrop, not from inside", async () => {
    mount({ reserved: [theirs] });
    await userEvent.click(blocks()[0]);
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(blocks()[0]);
    fireEvent.click(document.querySelector(".modal-overlay")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the booth, the day and the slot in the cancel dialog", async () => {
    mount({ reserved: [ours], boothName: "Booth 2", dateLabel: "Tue, 5 Aug" });
    await userEvent.click(blocks()[0]);
    const dialog = screen.getByRole("dialog", {
      name: "Cancel this reservation",
    });
    expect(dialog.className).toBe("modal ask-modal");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.parentElement?.className).toBe("modal-overlay");
    expect(dialog.querySelector("h2")?.textContent).toBe(
      "Cancel this reservation?",
    );
    const sub = dialog.querySelector(".modal-sub")!;
    expect(sub.querySelector("strong")?.textContent).toBe("Booth 2");
    expect(sub.querySelectorAll("br")).toHaveLength(2);
    expect(sub.textContent).toBe("Booth 2Tue, 5 Aug14:00 - 15:00");
    const buttons = [...dialog.querySelectorAll("button")];
    expect(buttons.map((b) => b.className)).toEqual([
      "modal-close",
      "btn ghost",
      "btn danger",
    ]);
    expect(buttons.map((b) => b.textContent)).toEqual([
      "\u00d7",
      "Keep it",
      "Yes, cancel it",
    ]);
    expect(buttons.every((b) => !b.disabled)).toBe(true);
    expect(dialog.querySelector(".error")).toBeNull();
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(document.querySelector(".modal-overlay")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("locks the cancel dialog while the request is in flight", async () => {
    let answer: (res: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => (answer = resolve))),
    );
    mount({ reserved: [ours] });
    await userEvent.click(blocks()[0]);
    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, cancel it" }),
    );
    const buttons = [...dialog.querySelectorAll("button")];
    expect(buttons.map((b) => b.disabled)).toEqual([true, true, true]);
    expect(buttons[2].textContent).toBe("Cancelling\u2026");
    fireEvent.click(document.querySelector(".modal-overlay")!);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBe(dialog);

    answer({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "That link has expired." }),
    });
    expect(await screen.findByText("That link has expired.")).toBeTruthy();
    expect(dialog.querySelector(".error")?.textContent).toBe(
      "That link has expired.",
    );
    expect(
      [...dialog.querySelectorAll("button")].map((b) => b.disabled),
    ).toEqual([false, false, false]);
    expect(screen.getByRole("button", { name: "Yes, cancel it" })).toBeTruthy();
  });
});

// A 390px phone: the day runs 1152px wide behind a 343px view.
const PHONE = { bar: 1150, tick: 27, tag: 71, tagText: 71, scroll: 343 };
const scroller = () => document.querySelector<HTMLElement>(".daycal-scroll")!;

describe("the day on a phone", () => {
  beforeEach(() => {
    layout.resize(PHONE);
  });

  it("brings a pick past the screen's edge into view, centred", () => {
    mount({ selection: { start: "18:00", end: "19:00" } });
    expect(scroller().scrollLeft).toBe(715);
  });

  it("leaves the track alone while the pick already shows", () => {
    mount({ selection: { start: "01:00", end: "02:00" } });
    expect(scroller().scrollLeft).toBe(0);
  });

  it("follows a pick changed from the time fields, stopping at the day's end", () => {
    const view = mount({ selection: { start: "01:00", end: "02:00" } });
    view.rerender(
      <DayTimeline
        earliest="00:00"
        reserved={[]}
        selection={{ start: "20:00", end: "21:00" }}
        step={5}
        minMinutes={15}
      />,
    );
    expect(scroller().scrollLeft).toBe(807);
  });

  it("opens on the next free hour when nothing is picked yet", () => {
    mount({ earliest: "15:30" });
    expect(scroller().scrollLeft).toBe(595);
  });

  it("keeps where the user swiped to while the pick stays put", () => {
    const view = mount({ selection: { start: "18:00", end: "19:00" } });
    scroller().scrollLeft = 0;
    view.rerender(
      <DayTimeline
        earliest="00:00"
        reserved={[]}
        selection={{ start: "18:00", end: "19:00" }}
        step={5}
        minMinutes={15}
      />,
    );
    expect(scroller().scrollLeft).toBe(0);
  });

  it("never scrolls a bar that fits its card", () => {
    layout.resize({ ...DESIGNED, scroll: 1128 });
    mount({ selection: { start: "20:00", end: "21:00" } });
    expect(scroller().scrollLeft).toBe(0);
  });
});

describe("picking by finger", () => {
  // One pixel a minute, so a pointer's clientX reads as the minute it lands on.
  const minuteWide = () => {
    const bar = document.querySelector<HTMLElement>(".daycal-bar")!;
    bar.getBoundingClientRect = () => ({ left: 0, width: 1440 }) as DOMRect;
  };
  const press = (el: Element, at: number, pointerType = "touch") =>
    fireEvent.pointerDown(el, { clientX: at, pointerType, isPrimary: true });
  const move = (at: number) =>
    fireEvent.pointerMove(window, { clientX: at, pointerType: "touch" });
  const lift = () => fireEvent.pointerUp(window);

  it("marks the hours under the pick, the ones a finger resizes it from", () => {
    mount({ onPick: vi.fn(), selection: { start: "10:15", end: "11:15" } });
    expect(hour("09:00", "10:00").className).toBe("daycal-cell free");
    expect(hour("10:00", "11:00").className).toBe("daycal-cell free in-pick");
    expect(hour("11:00", "12:00").className).toBe("daycal-cell free in-pick");
    expect(hour("12:00", "13:00").className).toBe("daycal-cell free");
  });

  it("moves the pick's end by the finger's travel, from its later half", () => {
    const onPick = vi.fn();
    mount({ onPick, selection: { start: "10:00", end: "11:00" } });
    minuteWide();
    press(hour("10:00", "11:00"), 645);
    move(700);
    lift();
    expect(onPick).toHaveBeenLastCalledWith("10:00", "11:55");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("moves the pick's start from its earlier half, keeping the end", () => {
    const onPick = vi.fn();
    mount({ onPick, selection: { start: "10:00", end: "11:00" } });
    minuteWide();
    press(hour("10:00", "11:00"), 610);
    move(580);
    lift();
    expect(onPick).toHaveBeenLastCalledWith("09:30", "11:00");
  });

  it("lets a finger off the pick swipe the track without picking anything", () => {
    const onPick = vi.fn();
    mount({ onPick, selection: { start: "10:00", end: "11:00" } });
    minuteWide();
    press(hour("14:00", "15:00"), 850);
    move(700);
    lift();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("takes the hour a finger taps off the pick", () => {
    const onPick = vi.fn();
    mount({ onPick, selection: { start: "10:00", end: "11:00" } });
    minuteWide();
    press(hour("14:00", "15:00"), 850);
    lift();
    expect(onPick).toHaveBeenCalledWith("14:00", "15:00");
  });

  it("picks nothing when the browser takes a touch over for scrolling", () => {
    const onPick = vi.fn();
    mount({ onPick });
    minuteWide();
    press(hour("14:00", "15:00"), 850);
    fireEvent.pointerCancel(window);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("still drags a fresh range from any hour with a mouse", () => {
    const onPick = vi.fn();
    mount({ onPick, selection: { start: "10:00", end: "11:00" } });
    minuteWide();
    press(hour("14:00", "15:00"), 850, "mouse");
    fireEvent.pointerMove(window, { clientX: 1000, pointerType: "mouse" });
    lift();
    expect(onPick).toHaveBeenLastCalledWith("14:00", "16:40");
  });

  it("tells a finger how to pick, only where picking is offered", () => {
    mount({ onPick: vi.fn() });
    const hint = document.querySelector(".daycal-hint")!;
    expect(hint.textContent).toBe("Tap an hour, drag your pick to resize");
    expect(hint.getAttribute("aria-hidden")).toBe("true");
    cleanup();
    mount();
    expect(document.querySelector(".daycal-hint")).toBeNull();
  });
});
