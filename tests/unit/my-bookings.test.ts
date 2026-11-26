import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";
import { canCancel, canEndNow, phaseOf } from "@/lib/my-bookings";

const D = "2026-07-16";
const at = (t: string) => `${D}T${t}`;

describe("phaseOf", () => {
  it("is upcoming before the start", () => {
    expect(phaseOf(at("10:00"), at("11:00"), at("09:59"))).toBe("upcoming");
  });

  it("is ongoing from the start minute itself", () => {
    expect(phaseOf(at("10:00"), at("11:00"), at("10:00"))).toBe("ongoing");
    expect(phaseOf(at("10:00"), at("11:00"), at("10:59"))).toBe("ongoing");
  });

  // Half-open, like every range here: the end minute already belongs to the next booking.
  it("is past from the end minute on", () => {
    expect(phaseOf(at("10:00"), at("11:00"), at("11:00"))).toBe("past");
  });

  it("compares across days as plain text", () => {
    expect(phaseOf(at("10:00"), at("11:00"), "2026-07-15T23:00")).toBe(
      "upcoming",
    );
    expect(phaseOf(at("10:00"), at("11:00"), "2026-07-17T00:00")).toBe("past");
  });
});

describe("what a member may do", () => {
  it("cancels an active booking only before it starts", () => {
    expect(canCancel({ status: "confirmed", phase: "upcoming" })).toBe(true);
    expect(canCancel({ status: "pending", phase: "upcoming" })).toBe(true);
    expect(canCancel({ status: "confirmed", phase: "ongoing" })).toBe(false);
    expect(canCancel({ status: "pending", phase: "ongoing" })).toBe(false);
    expect(canCancel({ status: "cancelled", phase: "upcoming" })).toBe(false);
    expect(canCancel({ status: "confirmed", phase: "past" })).toBe(false);
  });

  it("ends early only an active booking under way", () => {
    expect(canEndNow({ status: "confirmed", phase: "ongoing" })).toBe(true);
    expect(canEndNow({ status: "pending", phase: "ongoing" })).toBe(true);
    expect(canEndNow({ status: "cancelled", phase: "ongoing" })).toBe(false);
    expect(canEndNow({ status: "confirmed", phase: "upcoming" })).toBe(false);
    expect(canEndNow({ status: "confirmed", phase: "past" })).toBe(false);
  });
});

// "/" is edge-cached for everyone, so anything naming a member must say no-store.
describe("caching of the member's pages", () => {
  it("never lets a cache keep the bookings page or its API", async () => {
    const rules = await nextConfig.headers!();
    const noStore = (source: string) =>
      rules
        .find((r) => r.source === source)
        ?.headers.find((h) => h.key === "Cache-Control")?.value;
    expect(noStore("/bookings")).toBe("no-store");
    expect(noStore("/api/me/:path*")).toBe("no-store");
  });
});
