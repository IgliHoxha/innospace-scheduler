import { describe, expect, it } from "vitest";
import {
  EDGE_STALE_MS,
  availabilityQuery,
  countsForDate,
  edgeMayBeStale,
} from "@/lib/availability-url";
import nextConfig from "../../next.config.mjs";

const parse = (q: string) => new URLSearchParams(q);

describe("countsForDate", () => {
  const counts = { "booth-1": 2, "booth-2": 0 };

  it("hands back the counts of a board for the day on screen", () => {
    expect(countsForDate({ date: "2026-07-16", counts }, "2026-07-16")).toBe(
      counts,
    );
  });

  // The old board lingers while the next one loads; its numbers are another day's.
  it("withholds the counts of a board for a different day", () => {
    expect(
      countsForDate({ date: "2026-07-16", counts }, "2026-07-17"),
    ).toBeUndefined();
  });

  it("has nothing to give before any board has loaded", () => {
    expect(countsForDate(null, "2026-07-16")).toBeUndefined();
  });

  it("has nothing to give for a board that carries no counts", () => {
    expect(countsForDate({ date: "2026-07-16" }, "2026-07-16")).toBeUndefined();
  });

  it("withholds the counts of a board that does not say which day it is for", () => {
    expect(countsForDate({ counts }, "2026-07-16")).toBeUndefined();
  });
});

describe("edgeMayBeStale", () => {
  const WROTE = 1_700_000_000_000;

  it("is false for a browser that has never written", () => {
    expect(edgeMayBeStale(WROTE, 0)).toBe(false);
  });

  it("is true from the write until the window closes", () => {
    expect(edgeMayBeStale(WROTE, WROTE)).toBe(true);
    expect(edgeMayBeStale(WROTE + 1, WROTE)).toBe(true);
    expect(edgeMayBeStale(WROTE + EDGE_STALE_MS - 1, WROTE)).toBe(true);
  });

  it("is false once the edge's oldest possible copy has expired", () => {
    expect(edgeMayBeStale(WROTE + EDGE_STALE_MS, WROTE)).toBe(false);
    expect(edgeMayBeStale(WROTE + EDGE_STALE_MS * 10, WROTE)).toBe(false);
  });

  // The window is only right while it matches what next.config tells the edge.
  it("covers the s-maxage plus stale-while-revalidate the board is served with", async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === "/api/availability");
    const value = rule?.headers.find((h) => h.key === "Cache-Control")?.value;
    const seconds = (name: string) =>
      Number(new RegExp(`${name}=(\\d+)`).exec(value ?? "")?.[1]);
    expect(EDGE_STALE_MS).toBe(
      (seconds("s-maxage") + seconds("stale-while-revalidate")) * 1000,
    );
  });
});

describe("availabilityQuery", () => {
  it("carries the booth and date, and nothing else, for an ordinary load", () => {
    const p = parse(availabilityQuery("booth-1", "2026-07-16"));
    expect(p.get("booth")).toBe("booth-1");
    expect(p.get("date")).toBe("2026-07-16");
    expect(p.has("t")).toBe(false);
    expect([...p.keys()]).toHaveLength(2);
  });

  // Cloudflare caches 30s and ignores no-store, so only the URL forces a miss.
  it("adds the timestamp when the caller asks for a fresh board", () => {
    const p = parse(availabilityQuery("booth-1", "2026-07-16", 1_700_000_000));
    expect(p.get("t")).toBe("1700000000");
    expect(p.get("booth")).toBe("booth-1");
    expect(p.get("date")).toBe("2026-07-16");
  });

  it("gives two fresh loads different URLs, which is the whole point", () => {
    const a = availabilityQuery("booth-1", "2026-07-16", 1);
    const b = availabilityQuery("booth-1", "2026-07-16", 2);
    expect(a).not.toBe(b);
    // The ordinary form is stable, so the edge can still serve the common case.
    expect(availabilityQuery("booth-1", "2026-07-16")).toBe(
      availabilityQuery("booth-1", "2026-07-16"),
    );
  });

  it("treats a zero timestamp as a real request, not an absent one", () => {
    expect(parse(availabilityQuery("booth-1", "2026-07-16", 0)).get("t")).toBe(
      "0",
    );
  });

  it("escapes values rather than pasting them into the query raw", () => {
    const p = parse(availabilityQuery("booth &1=x", "2026-07-16"));
    expect(p.get("booth")).toBe("booth &1=x");
    expect(availabilityQuery("booth &1=x", "2026-07-16")).toContain("%26");
  });
});
