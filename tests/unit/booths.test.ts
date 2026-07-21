import { afterEach, describe, expect, it, vi } from "vitest";
import * as booths from "@/lib/booths";

afterEach(() => vi.unstubAllEnvs());

describe("default booths", () => {
  it("seeds booth-1..3 and resolves names + membership", () => {
    expect(booths.getBooths().map((b) => b.id)).toEqual([
      "booth-1",
      "booth-2",
      "booth-3",
    ]);
    expect(booths.isBoothId("booth-1")).toBe(true);
    expect(booths.isBoothId("nope")).toBe(false);
    expect(booths.isBoothId(undefined)).toBe(false);
    expect(booths.boothName("booth-2")).toBe("Booth 2");
    expect(booths.boothName("ghost")).toBe("ghost"); // unknown id echoes back
    expect(booths.boothName(undefined)).toBe("Booth");
  });
});

describe("SCHEDULER_BOOTHS override", () => {
  it("parses id:Name:capacity, tolerating missing name/capacity", async () => {
    vi.resetModules();
    vi.stubEnv("SCHEDULER_BOOTHS", "x:X Room:3, y:Y , z");
    const b = await import("@/lib/booths");
    const list = b.getBooths();
    expect(list.map((r) => r.id)).toEqual(["x", "y", "z"]);
    expect(list[0]).toMatchObject({ id: "x", name: "X Room", capacity: 3 });
    expect(list[1]).toMatchObject({ id: "y", name: "Y" });
    expect(list[2]).toMatchObject({ id: "z", name: "z" }); // name defaults to id
    expect(b.isBoothId("booth-1")).toBe(false); // defaults no longer apply
  });

  it("skips empty entries; throws when none are parseable", async () => {
    vi.resetModules();
    vi.stubEnv("SCHEDULER_BOOTHS", "a:A, ,b:B"); // middle entry has no id
    const b = await import("@/lib/booths");
    expect(b.getBooths().map((r) => r.id)).toEqual(["a", "b"]);

    vi.resetModules();
    vi.stubEnv("SCHEDULER_BOOTHS", " , : "); // nothing parseable
    const empty = await import("@/lib/booths");
    expect(() => empty.getBooths()).toThrow();
  });
});
