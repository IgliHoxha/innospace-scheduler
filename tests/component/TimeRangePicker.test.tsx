// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TimeRangePicker, { TYPING_PAUSE_MS } from "@/app/TimeRangePicker";

// Events are fired by hand here: user-event waits on the very timers this file fakes.
beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const RANGE = { from: "09:00", to: "10:00" };
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const type = (id: string, value: string) =>
  fireEvent.input(field(id), { target: { value } });
const leave = (id: string, to: Element | null) =>
  fireEvent.blur(field(id), { relatedTarget: to });

function mount() {
  const onEditing = vi.fn();
  const view = render(
    <>
      <TimeRangePicker
        value={RANGE}
        onChange={() => {}}
        defaultRange={RANGE}
        onEditing={onEditing}
      />
      <button type="button">elsewhere</button>
    </>,
  );
  /** Every answer so far, oldest first. */
  const said = () => onEditing.mock.calls.map(([editing]) => editing);
  return { onEditing, said, ...view };
}

describe("the time fields saying whether a time is being typed", () => {
  it("is not typing just because the caret is in a field", () => {
    const { said } = mount();
    fireEvent.focus(field("end-hours"));
    wait(TYPING_PAUSE_MS * 2);
    expect(said()).not.toContain(true);
  });

  it("is typing from a keystroke until the pause has run out", () => {
    const { onEditing } = mount();
    type("end-hours", "101");
    expect(onEditing).toHaveBeenLastCalledWith(true);
    wait(TYPING_PAUSE_MS - 1);
    expect(onEditing).toHaveBeenLastCalledWith(true);
    wait(1);
    expect(onEditing).toHaveBeenLastCalledWith(false);
  });

  // The hour and its minutes are one time, however long the finger takes between them.
  it("starts the pause again with every keystroke, across the fields too", () => {
    const { onEditing, said } = mount();
    for (const [id, value] of [
      ["end-hours", "101"],
      ["end-hours", "11"],
      ["end-minutes", "003"],
      ["end-minutes", "30"],
    ]) {
      type(id, value);
      wait(TYPING_PAUSE_MS - 100);
    }
    expect(said()).not.toContain(false);
    wait(100);
    expect(onEditing).toHaveBeenLastCalledWith(false);
  });

  it("counts an arrow key that steps the value as typing", () => {
    const { onEditing } = mount();
    fireEvent.keyDown(field("end-minutes"), { key: "ArrowUp" });
    expect(onEditing).toHaveBeenLastCalledWith(true);
  });

  it("stops at once when the caret leaves the fields, with no pause to wait out", () => {
    const { onEditing } = mount();
    type("end-hours", "101");
    leave("end-hours", document.querySelector("button"));
    expect(onEditing).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not stop for a move from one field to another", () => {
    const { said } = mount();
    type("end-hours", "101");
    leave("end-hours", field("start-minutes"));
    expect(said()).not.toContain(false);
  });

  // A removed field gets no blur in Safari, and a timer must not answer for fields long gone.
  it("stops when the fields go away mid-typing, leaving no timer behind", () => {
    const { onEditing, unmount } = mount();
    type("end-minutes", "003");
    unmount();
    expect(onEditing).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
