// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClockMinutes } from "@/app/_booking/use-clock";
import { localMinutes } from "@/lib/datetime";

const at = (hhmmss: string) => new Date(`2026-07-16T${hhmmss}`);
const minute = (hhmmss: string) => localMinutes(at(hhmmss).getTime());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(at("12:02:30"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useClockMinutes", () => {
  it("starts on the minute it is", () => {
    const { result } = renderHook(() => useClockMinutes());
    expect(result.current).toBe(minute("12:02:00"));
  });

  it("turns over on the minute itself, not a minute after it was opened", () => {
    const { result } = renderHook(() => useClockMinutes());
    act(() => void vi.advanceTimersByTime(29_000));
    expect(result.current).toBe(minute("12:02:00"));
    act(() => void vi.advanceTimersByTime(1_100));
    expect(result.current).toBe(minute("12:03:00"));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(minute("12:04:00"));
  });

  // A locked phone runs no timers, so the screen coming back is the first chance to look.
  it("reads the clock at once when the tab comes back", () => {
    const { result } = renderHook(() => useClockMinutes());
    vi.setSystemTime(at("12:40:10"));
    expect(result.current).toBe(minute("12:02:00"));
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(minute("12:40:00"));
  });

  it("leaves no timer or listener behind", () => {
    const { result, unmount } = renderHook(() => useClockMinutes());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(at("12:40:10"));
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(minute("12:02:00"));
  });
});
