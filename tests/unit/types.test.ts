import { describe, expect, it } from "vitest";
import {
  ACTIVE_STATUSES,
  isActiveStatus,
  isReservationStatus,
  MAX_EMAIL,
  MAX_EMAIL_BODY,
  MAX_NAME,
  MAX_NOTE,
  MAX_PASSWORD,
  RESERVATION_STATUSES,
} from "@/lib/types";

describe("reservation statuses + caps", () => {
  it("declares the four statuses in a stable order", () => {
    expect(RESERVATION_STATUSES).toEqual([
      "pending",
      "confirmed",
      "cancelled",
      "deleted",
    ]);
  });

  it("marks confirmed + pending as slot-holding, a subset of all statuses", () => {
    expect(ACTIVE_STATUSES).toEqual(["confirmed", "pending"]);
    for (const s of ACTIVE_STATUSES) {
      expect(RESERVATION_STATUSES).toContain(s);
    }
  });

  it("exposes the server-side length caps used by validators", () => {
    expect(MAX_NOTE).toBe(500);
    expect(MAX_NAME).toBe(80);
    expect(MAX_EMAIL).toBe(254);
    expect(MAX_PASSWORD).toBe(200);
    expect(MAX_EMAIL_BODY).toBe(5000);
  });
});

describe("status guards", () => {
  it("accepts each of the four statuses", () => {
    for (const s of RESERVATION_STATUSES) {
      expect(isReservationStatus(s)).toBe(true);
    }
  });

  it("refuses the list filter word, unknown strings and wrong casing", () => {
    for (const v of ["all", "bogus", "", "Pending", " pending", "pending "]) {
      expect(isReservationStatus(v)).toBe(false);
    }
  });

  it("refuses anything that is not a string", () => {
    for (const v of [undefined, null, 5, 0, true, {}, [], ["pending"]]) {
      expect(isReservationStatus(v)).toBe(false);
    }
  });

  it("counts confirmed + pending as active and nothing else", () => {
    expect(isActiveStatus("confirmed")).toBe(true);
    expect(isActiveStatus("pending")).toBe(true);
    expect(isActiveStatus("cancelled")).toBe(false);
    expect(isActiveStatus("deleted")).toBe(false);
  });

  it("agrees with ACTIVE_STATUSES for every status", () => {
    const active: readonly string[] = ACTIVE_STATUSES;
    for (const s of RESERVATION_STATUSES) {
      expect(isActiveStatus(s)).toBe(active.includes(s));
    }
  });
});
