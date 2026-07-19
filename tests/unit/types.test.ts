import { describe, expect, it } from "vitest";
import {
  MAX_EMAIL,
  MAX_EMAIL_BODY,
  MAX_NAME,
  MAX_NOTE,
  MAX_PASSWORD,
  MIN_PASSWORD,
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

  it("exposes the server-side length caps used by validators", () => {
    expect(MAX_NOTE).toBe(500);
    expect(MAX_NAME).toBe(80);
    expect(MAX_EMAIL).toBe(254);
    expect(MAX_PASSWORD).toBe(200);
    expect(MIN_PASSWORD).toBe(6);
    expect(MAX_EMAIL_BODY).toBe(5000);
  });
});
