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
});
