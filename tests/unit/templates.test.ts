import { describe, expect, it } from "vitest";
import * as t from "@/lib/templates";
import type { ContactInfo, Reservation } from "@/lib/types";

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

// Every ContactInfo field is required now (populated from env in production).
const contact: ContactInfo = {
  name: "Alex",
  org: "Test Org",
  phone: "+000 1",
  email: "hi@test.co",
  url: "https://test.co",
};

describe("reservation display helpers", () => {
  it("timeText uses the product en dash, or a placeholder when unset", () => {
    expect(t.timeText(base)).toBe("09:30 - 11:00");
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
      "Booth 1 · Tuesday, 14 July 2026 · 09:30 - 11:00",
    );
  });
});

describe("email copy", () => {
  it("subject varies by status", () => {
    expect(t.emailSubject("confirmed", contact, base)).toContain("confirmed");
    expect(t.emailSubject("pending", contact, base)).toContain("received");
    expect(t.emailSubject("cancelled", contact, base)).toContain("Update");
  });

  it("subject uses the org name from contact", () => {
    expect(t.emailSubject("cancelled", contact, base)).toContain("at Test Org");
    expect(t.emailSubject("pending", contact, base)).toContain("at Test Org");
  });

  it("heading varies by status", () => {
    expect(t.emailHeading("confirmed")).toBe("Reservation confirmed");
    expect(t.emailHeading("pending")).toBe("Reservation request received");
    expect(t.emailHeading("cancelled")).toBe("Reservation cancelled");
  });

  it("body greets by first name and includes the details + note", () => {
    const body = t.emailBodyText(
      { ...base, note: "Client call" },
      "confirmed",
      contact,
    );
    expect(body).toContain("Hi Ada,");
    expect(body).toContain("Booth 1");
    expect(body).toContain("09:30 - 11:00");
    expect(body).toContain("Note: Client call");
  });

  it('falls back to "there" when there is no name', () => {
    expect(
      t.emailBodyText({ ...base, fullName: undefined }, "pending", contact),
    ).toContain("Hi there,");
  });

  it("cancelled body greets by first name, or plainly when unset", () => {
    const body = t.emailBodyText(
      { ...base, status: "cancelled" },
      "cancelled",
      contact,
    );
    expect(body).toContain("Hello Ada,");
    expect(body).toContain("cancelled");
    expect(
      t.emailBodyText({ ...base, fullName: undefined }, "cancelled", contact),
    ).toContain("Hello,");
  });

  it("cancelled body uses the org name from contact", () => {
    expect(t.emailBodyText(base, "cancelled", contact)).toContain(
      "booth at Test Org.",
    );
  });
});

describe("contact footer", () => {
  it("signOff is the canonical closing: Best regards, name, org, phone, email", () => {
    expect(t.signOff(contact)).toEqual([
      "Best regards,",
      "Alex",
      "",
      "Test Org",
      "",
      "Phone: +000 1",
      "Email: hi@test.co",
    ]);
  });

  it("every email renders the full contact block", () => {
    for (const status of ["confirmed", "pending", "cancelled"] as const) {
      const body = t.emailBodyText(base, status, contact);
      expect(body).toContain("Best regards,");
      expect(body).toContain("Alex");
      expect(body).toContain("Test Org");
      expect(body).toContain("Phone: +000 1");
      expect(body).toContain("Email: hi@test.co");
    }
  });
});
