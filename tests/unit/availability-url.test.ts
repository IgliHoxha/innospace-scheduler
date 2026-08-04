import { describe, expect, it } from "vitest";
import { availabilityQuery } from "@/lib/availability-url";

const parse = (q: string) => new URLSearchParams(q);

describe("availabilityQuery", () => {
  it("carries the booth and date, and nothing else, for an ordinary load", () => {
    const p = parse(availabilityQuery("booth-1", "2026-07-16"));
    expect(p.get("booth")).toBe("booth-1");
    expect(p.get("date")).toBe("2026-07-16");
    expect(p.has("t")).toBe(false);
    expect([...p.keys()]).toHaveLength(2);
  });

  // Cloudflare caches the board for 30s and ignores a request's no-store, so only the URL can force a miss.
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
