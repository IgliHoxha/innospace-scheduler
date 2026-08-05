import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  heldRangesFor,
  readMine,
  rememberMine,
  slotKey,
  type MineEntry,
} from "@/lib/mine";

const KEY = "innospace.mine";
const DAY = "2026-07-16";

/** Minimal in-memory Storage: the suite runs on node, which has no localStorage. */
function installStorage(opts: { throwOnWrite?: boolean } = {}) {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.throwOnWrite) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
  vi.stubGlobal("localStorage", store);
  return map;
}

const entry = (over: Partial<MineEntry> = {}): MineEntry => ({
  k: slotKey("booth-1", `${DAY}T14:00`),
  s: `${DAY}T14:00`,
  e: `${DAY}T15:00`,
  m: "ada@example.com",
  t: "tok",
  ...over,
});

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
});
afterEach(() => vi.unstubAllGlobals());

describe("slotKey", () => {
  it("joins booth and start so one booth's slot can't collide with another's", () => {
    expect(slotKey("booth-1", `${DAY}T14:00`)).toBe(`booth-1|${DAY}T14:00`);
    expect(slotKey("booth-1", `${DAY}T14:00`)).not.toBe(
      slotKey("booth-2", `${DAY}T14:00`),
    );
  });
});

describe("readMine", () => {
  it("returns nothing when the key was never written", () => {
    expect(readMine()).toEqual([]);
  });

  it("round-trips what rememberMine stored", () => {
    rememberMine(entry());
    expect(readMine()).toEqual([entry()]);
  });

  // Bare key strings predate the run rule needing times, and must still label "You".
  it("upgrades a legacy bare-string entry instead of dropping it", () => {
    store.set(KEY, JSON.stringify([`booth-1|${DAY}T09:00`]));
    expect(readMine()).toEqual([
      { k: `booth-1|${DAY}T09:00`, s: "", e: "", m: "", t: "" },
    ]);
  });

  it("fills missing fields on a half-written entry", () => {
    store.set(KEY, JSON.stringify([{ k: "booth-1|x" }]));
    expect(readMine()).toEqual([
      { k: "booth-1|x", s: "", e: "", m: "", t: "" },
    ]);
  });

  it("drops entries with no key at all, keeping the good ones", () => {
    store.set(KEY, JSON.stringify([{ s: "no key" }, null, 42, entry()]));
    expect(readMine()).toEqual([entry()]);
  });

  it("survives unparseable JSON, a non-array, and a thrown getItem", () => {
    store.set(KEY, "{ not json");
    expect(readMine()).toEqual([]);
    store.set(KEY, JSON.stringify({ nope: true }));
    expect(readMine()).toEqual([]);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
    });
    expect(readMine()).toEqual([]);
  });
});

describe("rememberMine", () => {
  it("puts the newest first and returns the new list", () => {
    rememberMine(entry({ k: "a", s: `${DAY}T09:00` }));
    const next = rememberMine(entry({ k: "b", s: `${DAY}T10:00` }));
    expect(next.map((m) => m.k)).toEqual(["b", "a"]);
    expect(readMine().map((m) => m.k)).toEqual(["b", "a"]);
  });

  it("replaces an entry for the same slot rather than duplicating it", () => {
    rememberMine(entry({ t: "old" }));
    const next = rememberMine(entry({ t: "new" }));
    expect(next).toHaveLength(1);
    expect(next[0].t).toBe("new");
  });

  it("caps the list, discarding the oldest", () => {
    for (let i = 0; i < 60; i++) rememberMine(entry({ k: `slot-${i}` }));
    const kept = readMine();
    expect(kept).toHaveLength(50);
    expect(kept[0].k).toBe("slot-59"); // newest survives
    expect(kept.some((m) => m.k === "slot-0")).toBe(false); // oldest evicted
  });

  it("still returns the list when storage refuses the write", () => {
    installStorage({ throwOnWrite: true });
    const next = rememberMine(entry());
    // The board can still say "You" this session; it just won't survive a reload.
    expect(next).toEqual([entry()]);
    expect(readMine()).toEqual([]);
  });
});

describe("heldRangesFor", () => {
  // The board showing this slot is the only proof the booking still exists.
  const base = {
    entries: [entry()],
    booker: "ada@example.com",
    boothId: "booth-1",
    date: DAY,
    boardStarts: ["14:00"] as string[],
  };

  it("returns nothing until the form knows who is booking", () => {
    expect(heldRangesFor({ ...base, booker: "" })).toEqual([]);
  });

  it("returns the range in minutes since midnight", () => {
    expect(heldRangesFor(base)).toEqual([{ start: 840, end: 900 }]);
  });

  it("matches the booker canonically, so a Gmail alias is the same person", () => {
    const e = [entry({ m: "a.d.a+work@gmail.com" })];
    expect(
      heldRangesFor({ ...base, entries: e, booker: "ada@gmail.com" }).length,
    ).toBe(1);
    expect(
      heldRangesFor({ ...base, entries: e, booker: "someone@gmail.com" }),
    ).toEqual([]);
  });

  it("ignores another day's bookings", () => {
    expect(heldRangesFor({ ...base, date: "2026-07-17" })).toEqual([]);
  });

  it("ignores a legacy entry that has no end time to count", () => {
    expect(heldRangesFor({ ...base, entries: [entry({ e: "" })] })).toEqual([]);
  });

  // A cancelled booking is still remembered, so the board is the check.
  it("drops an entry the board no longer shows", () => {
    expect(heldRangesFor({ ...base, boardStarts: [] })).toEqual([]);
    expect(heldRangesFor(base)).toHaveLength(1);
  });

  // No board on screen can contradict another booth's entry.
  it("drops an entry for another booth, which nothing here can confirm", () => {
    expect(
      heldRangesFor({ ...base, boothId: "booth-2", boardStarts: ["14:00"] }),
    ).toEqual([]);
  });

  // The shape that blocked a one-hour booking: a phantom neighbour.
  it("does not count a cancelled neighbour still sitting in storage", () => {
    const entries = [
      entry({
        k: `booth-1|${DAY}T14:00`,
        s: `${DAY}T14:00`,
        e: `${DAY}T15:00`,
      }),
      entry({
        k: `booth-1|${DAY}T15:00`,
        s: `${DAY}T15:00`,
        e: `${DAY}T16:00`,
      }),
    ];
    // Only 14:00 survives the board, so the 15:00 one must not extend the run.
    expect(heldRangesFor({ ...base, entries })).toEqual([
      { start: 840, end: 900 },
    ]);
  });

  it("returns every qualifying booking, so the run rule sees the whole board", () => {
    const entries = [
      entry({
        k: `booth-1|${DAY}T09:00`,
        s: `${DAY}T09:00`,
        e: `${DAY}T10:00`,
      }),
      entry({
        k: `booth-1|${DAY}T10:00`,
        s: `${DAY}T10:00`,
        e: `${DAY}T11:00`,
      }),
    ];
    expect(
      heldRangesFor({ ...base, entries, boardStarts: ["09:00", "10:00"] }),
    ).toEqual([
      { start: 540, end: 600 },
      { start: 600, end: 660 },
    ]);
  });
});
