import { describe, expect, it } from "vitest";
import { bookedMessage, bookingWhen } from "@/lib/booking-messages";

const ONE = {
  boothName: "Booth 2",
  date: "2026-11-10",
  start: "09:00",
  end: "10:30",
  repeatWeeks: 1,
};

describe("bookingWhen", () => {
  it("names the booth, the long date and the range", () => {
    expect(bookingWhen(ONE)).toBe(
      "Booth 2 on Tuesday, 10 November 2026, 09:00 - 10:30",
    );
  });

  it("adds the repeat for a weekly series", () => {
    expect(bookingWhen({ ...ONE, repeatWeeks: 4 })).toMatch(
      /, 09:00 - 10:30, .+4 weeks$/,
    );
  });
});

describe("bookedMessage", () => {
  const base = {
    when: "Booth 2 on Tuesday, 10 November 2026, 09:00 - 10:30",
    pending: false,
    repeatWeeks: 1,
    autoApproveMaxHours: 2,
    email: "ada@example.com",
  };

  it("confirms a booking and says where the cancel link went", () => {
    expect(bookedMessage(base)).toBe(
      "Reserved Booth 2 on Tuesday, 10 November 2026, 09:00 - 10:30. We've emailed ada@example.com a confirmation, with a link to cancel if your plans change.",
    );
  });

  it("tells a pending booker the limit, the wait, and that the slot is held", () => {
    expect(bookedMessage({ ...base, pending: true })).toBe(
      "Request submitted: Booth 2 on Tuesday, 10 November 2026, 09:00 - 10:30. Reservations over 2 hours need admin approval - we'll email you once it's reviewed. The slot is held for you meanwhile.",
    );
  });

  it("holds every date of a pending series", () => {
    expect(bookedMessage({ ...base, pending: true, repeatWeeks: 3 })).toMatch(
      /The slots are held for you meanwhile\.$/,
    );
  });
});
