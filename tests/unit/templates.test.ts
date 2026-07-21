import { afterEach, describe, expect, it, vi } from "vitest";
import * as t from "@/lib/templates";
import type { Reservation } from "@/lib/types";

const base: Reservation = {
  id: "r1",
  createdAt: "2026-07-14T08:00:00.000Z",
  updatedAt: "2026-07-14T08:00:00.000Z",
  status: "confirmed",
  boothId: "booth-1",
  startsAt: "2026-07-14T09:30",
  endsAt: "2026-07-14T11:00",
  fullName: "Ada Lovelace",
};

describe("date + time formatting", () => {
  it("formatDMYShort", () => {
    expect(t.formatDMYShort("2026-07-14")).toBe("14/07/26");
    expect(t.formatDMYShort(undefined)).toBe("-");
  });

  it("formatDateLong", () => {
    expect(t.formatDateLong("2026-07-14")).toMatch(/^[A-Za-z]+, 14 July 2026$/);
    expect(t.formatDateLong(undefined)).toBe("your requested date");
  });

  it("formatDateMedium", () => {
    expect(t.formatDateMedium("2026-07-14")).toMatch(/^[A-Za-z]{3}, 14 Jul$/);
    expect(t.formatDateMedium(undefined)).toBe("");
  });

  it("formatDateTime renders a local DD/MM/YY HH:MM, or empty for junk", () => {
    expect(t.formatDateTime("2026-07-14T14:30:00")).toBe("14/07/26 14:30");
    expect(t.formatDateTime("not-a-date")).toBe("");
  });
});

describe("reservation display helpers", () => {
  it("timeText uses the product en dash, or a placeholder when unset", () => {
    expect(t.timeText(base)).toBe("09:30 – 11:00");
    expect(
      t.timeText({ ...base, startsAt: undefined, endsAt: undefined }),
    ).toBe("-");
  });

  it("boothLabel resolves the booth name", () => {
    expect(t.boothLabel(base)).toBe("Booth 1");
    expect(t.boothLabel({ ...base, boothId: "unknown" })).toBe("unknown");
  });

  it("reservationSummary joins booth, date and time", () => {
    expect(t.reservationSummary(base)).toBe(
      "Booth 1 · Tuesday, 14 July 2026 · 09:30 – 11:00",
    );
  });
});

describe("email copy", () => {
  it("subject varies by status", () => {
    expect(t.emailSubject("confirmed", base)).toContain("confirmed");
    expect(t.emailSubject("pending", base)).toContain("received");
    expect(t.emailSubject("cancelled", base)).toContain("Update");
  });

  it("heading varies by status", () => {
    expect(t.emailHeading("confirmed")).toBe("Booking confirmed");
    expect(t.emailHeading("pending")).toBe("Booking request received");
    expect(t.emailHeading("cancelled")).toBe("Booking cancelled");
  });

  it("body greets by first name and includes the details + note", () => {
    const body = t.emailBodyText({ ...base, note: "Client call" }, "confirmed");
    expect(body).toContain("Hi Ada,");
    expect(body).toContain("Booth 1");
    expect(body).toContain("09:30 – 11:00");
    expect(body).toContain("Note: Client call");
  });

  it('falls back to "there" when there is no name', () => {
    expect(
      t.emailBodyText({ ...base, fullName: undefined }, "pending"),
    ).toContain("Hi there,");
  });

  it("cancelled body greets by first name, or plainly when unset", () => {
    const body = t.emailBodyText({ ...base, status: "cancelled" }, "cancelled");
    expect(body).toContain("Hello Ada,");
    expect(body).toContain("cancelled");
    expect(
      t.emailBodyText({ ...base, fullName: undefined }, "cancelled"),
    ).toContain("Hello,");
  });
});

describe("contact footer (env-driven)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("getContactFromEnv reads the BUSINESS_* vars", () => {
    vi.stubEnv("BUSINESS_NAME", "Test Org");
    vi.stubEnv("BUSINESS_PHONE", "+355 1");
    vi.stubEnv("BUSINESS_EMAIL", "hi@test.co");
    expect(t.getContactFromEnv()).toMatchObject({
      org: "Test Org",
      phone: "+355 1",
      email: "hi@test.co",
    });
  });

  it("confirmed email includes only the contact fields provided", () => {
    const body = t.emailBodyText(base, "confirmed", {
      phone: "+355 1",
      email: "hi@test.co",
    });
    expect(body).toContain("Phone: +355 1");
    expect(body).toContain("Email: hi@test.co");
  });

  it("confirmed email omits the phone/email rows when no contact is given", () => {
    const body = t.emailBodyText(base, "confirmed");
    expect(body).toContain("InnoSpace Tirana"); // org default
    expect(body).not.toContain("Phone:");
    expect(body).not.toContain("Email:");
  });
});
