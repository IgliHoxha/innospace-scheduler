import { describe, expect, it, vi } from "vitest";
import * as t from "@/lib/templates";
import { boothNameIn } from "@/lib/booths";
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

// Resolver passed to the pure helpers, standing in for the env-backed lookup.
const booths = [{ id: "booth-1", name: "Booth 1" }];
const boothName = (id: string | undefined) => boothNameIn(booths, id);

// Every ContactInfo field is required now (populated from env in production).
const contact: ContactInfo = {
  name: "Alex",
  org: "Test Org",
  phone: "+000 1",
  email: "hi@test.co",
  url: "https://test.co",
};

describe("reservation display helpers", () => {
  it("timeText uses the product hyphen, or a placeholder when unset", () => {
    expect(t.timeText(base)).toBe("09:30 - 11:00");
    expect(
      t.timeText({ ...base, startsAt: undefined, endsAt: undefined }),
    ).toBe("-");
  });

  it("boothLabel resolves the booth name via the supplied resolver", () => {
    expect(t.boothLabel(base, boothName)).toBe("Booth 1");
    expect(t.boothLabel({ ...base, boothId: "unknown" }, boothName)).toBe(
      "unknown",
    );
  });

  it("reservationSummary joins booth, date and time", () => {
    expect(t.reservationSummary(base, boothName)).toBe(
      "Booth 1 · Tuesday, 14 July 2026 · 09:30 - 11:00",
    );
  });

  // These helpers must never read env themselves, so they stay usable in a browser bundle.
  it("stays pure with SCHEDULER_BOOTHS unset (no env read of its own)", () => {
    vi.stubEnv("SCHEDULER_BOOTHS", "");
    expect(t.boothLabel(base, boothName)).toBe("Booth 1");
    expect(t.emailBodyText(base, "confirmed", contact, boothName)).toContain(
      "Booth 1",
    );
    vi.unstubAllEnvs();
  });
});

describe("email copy", () => {
  it("subject varies by status", () => {
    expect(t.emailSubject("confirmed", contact, boothName, base)).toContain(
      "confirmed",
    );
    expect(t.emailSubject("pending", contact, boothName, base)).toContain(
      "received",
    );
    expect(t.emailSubject("cancelled", contact, boothName, base)).toContain(
      "Update",
    );
  });

  it("subject uses the org name from contact", () => {
    expect(t.emailSubject("cancelled", contact, boothName, base)).toContain(
      "at Test Org",
    );
    expect(t.emailSubject("pending", contact, boothName, base)).toContain(
      "at Test Org",
    );
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
      boothName,
    );
    expect(body).toContain("Hi Ada,");
    expect(body).toContain("Booth 1");
    expect(body).toContain("09:30 - 11:00");
    expect(body).toContain("Note: Client call");
  });

  it('falls back to "there" when there is no name', () => {
    expect(
      t.emailBodyText(
        { ...base, fullName: undefined },
        "pending",
        contact,
        boothName,
      ),
    ).toContain("Hi there,");
  });

  it("cancelled body greets by first name, or plainly when unset", () => {
    const body = t.emailBodyText(
      { ...base, status: "cancelled" },
      "cancelled",
      contact,
      boothName,
    );
    expect(body).toContain("Hello Ada,");
    expect(body).toContain("cancelled");
    expect(
      t.emailBodyText(
        { ...base, fullName: undefined },
        "cancelled",
        contact,
        boothName,
      ),
    ).toContain("Hello,");
  });

  it("cancelled body uses the org name from contact", () => {
    expect(t.emailBodyText(base, "cancelled", contact, boothName)).toContain(
      "booth at Test Org.",
    );
  });
});

describe("contact footer", () => {
  it("signOff is the canonical closing: Best regards, name, phone, email", () => {
    expect(t.signOff(contact)).toEqual([
      "Best regards,",
      "Alex",
      "",
      "Phone: +000 1",
      "Email: hi@test.co",
    ]);
  });

  // EMAIL_SIGNOFF_NAME already carries the org and the footer prints it, so don't repeat it.
  it("does not repeat the org inside the sign-off", () => {
    expect(t.signOff(contact)).not.toContain("Test Org");
  });

  it("every email renders the full contact block", () => {
    for (const status of ["confirmed", "pending", "cancelled"] as const) {
      const body = t.emailBodyText(base, status, contact, boothName);
      expect(body).toContain("Best regards,");
      expect(body).toContain("Alex");
      expect(body).toContain("Phone: +000 1");
      expect(body).toContain("Email: hi@test.co");
    }
  });
});

describe("reservations missing their times", () => {
  it("has no date to report when startsAt is absent", () => {
    expect(
      t.dateOfReservation({ ...base, startsAt: undefined }),
    ).toBeUndefined();
  });

  it("names the booth generically when there is no reservation to name it from", () => {
    const subject = t.emailSubject("confirmed", contact, boothName);
    expect(subject).toContain("meeting booth");
    expect(subject).not.toContain("undefined");
  });

  it("says 'your requested date' rather than printing undefined", () => {
    const subject = t.emailSubject("confirmed", contact, boothName, {
      ...base,
      startsAt: undefined,
    });
    expect(subject).toBe(
      "Your Booth 1 reservation is confirmed for your requested date",
    );
  });
});

describe("the note line in a pending request", () => {
  it("is included when a note was given", () => {
    const body = t.emailBodyText(
      { ...base, status: "pending", note: "  Team workshop  " },
      "pending",
      contact,
      boothName,
    );
    expect(body).toContain("Note: Team workshop");
  });

  it("is left out entirely when the note is blank", () => {
    for (const note of [undefined, "", "   "]) {
      const body = t.emailBodyText(
        { ...base, status: "pending", note },
        "pending",
        contact,
        boothName,
      );
      expect(body).not.toContain("Note:");
    }
  });
});

// The notification snippet: without one, a client scrapes the wordmark spans and shows "innospaceTIRANA".
describe("the email preheader", () => {
  const pre = (status: t.EmailStatus, r: Reservation = base) =>
    t.emailPreheader(r, status, contact, boothName);

  it("leads with the status, since the cancellation subject only says 'Update'", () => {
    expect(pre("confirmed")).toMatch(/^Confirmed: /);
    expect(pre("pending")).toMatch(/^Awaiting approval: /);
    expect(pre("cancelled")).toMatch(/^Cancelled: /);
  });

  it("carries the booth, day, time and the organisation in every status", () => {
    for (const status of ["confirmed", "pending", "cancelled"] as const) {
      expect(pre(status)).toContain(
        "Booth 1 · Tuesday, 14 July 2026 · 09:30 - 11:00",
      );
      expect(pre(status)).toContain("Test Org");
    }
  });

  it("says the same thing as the summary shown everywhere else", () => {
    expect(pre("confirmed")).toContain(t.reservationSummary(base, boothName));
  });

  it("adds what the reader should do next, and it differs by status", () => {
    expect(pre("confirmed")).toContain("cancel link");
    expect(pre("pending")).toContain("held for you");
    expect(pre("cancelled")).toContain("reserve another slot");
  });

  // A notification shows roughly this much, so the details must land before the tail is cut.
  it("fits the booking details inside the first 100 characters", () => {
    for (const status of ["confirmed", "pending", "cancelled"] as const) {
      expect(pre(status).slice(0, 100)).toContain("09:30 - 11:00");
    }
  });

  it("still reads when the reservation has no times", () => {
    const bare = { ...base, startsAt: undefined, endsAt: undefined };
    expect(pre("confirmed", bare)).toContain("Test Org");
    expect(pre("confirmed", bare)).not.toContain("undefined");
  });

  it("uses only ASCII hyphens, like every other piece of product copy", () => {
    for (const status of ["confirmed", "pending", "cancelled"] as const) {
      expect(pre(status)).not.toMatch(/[–—]/);
    }
  });
});
