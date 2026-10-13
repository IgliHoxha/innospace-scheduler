import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeAnswer,
  isTelegramWebhook,
  refusalFor,
  replyAction,
} from "@/lib/telegram-reply";
import type { Reservation, ReservationStatus } from "@/lib/types";
import { WEBHOOK_SECRET } from "../helpers/fixtures";

afterEach(() => vi.unstubAllEnvs());

describe("replyAction", () => {
  it.each([
    ["yes", "approve"],
    ["no", "cancel"],
    ["delete", "delete"],
  ] as const)("reads %s as %s", (word, action) => {
    expect(replyAction(word)).toBe(action);
  });

  it.each([["Yes"], ["YES"], ["  yes  "], ["yes."], ["Yes!"], ["yes!!\n"]])(
    "forgives the casing, spacing and full stop a phone adds (%j)",
    (text) => {
      expect(replyAction(text)).toBe("approve");
    },
  );

  it.each([
    [""],
    ["   "],
    ["yes please"],
    ["not yet"],
    ["nope"],
    ["y"],
    ["approve"],
    ["cancel"],
    ["deleted"],
    ["delete all"],
    ["/yes"],
    ["yes?"],
    ["constructor"],
    ["__proto__"],
  ])("reads nothing into %j", (text) => {
    expect(replyAction(text)).toBeNull();
  });
});

describe("refusalFor", () => {
  const allowed: [
    action: "approve" | "cancel" | "delete",
    ReservationStatus,
  ][] = [
    ["approve", "pending"],
    ["cancel", "pending"],
    ["cancel", "confirmed"],
    ["delete", "pending"],
    ["delete", "confirmed"],
    ["delete", "cancelled"],
  ];

  it.each(allowed)("lets %s through on a %s reservation", (action, status) => {
    expect(refusalFor(action, status)).toBeNull();
  });

  it("will not approve what is not waiting for approval", () => {
    expect(refusalFor("approve", "confirmed")).toBe(
      "This reservation is already confirmed.",
    );
    expect(refusalFor("approve", "cancelled")).toBe(
      "Only a reservation awaiting approval can be approved, and this one is cancelled.",
    );
    expect(refusalFor("approve", "deleted")).toBe(
      "Only a reservation awaiting approval can be approved, and this one is deleted.",
    );
  });

  it("will not cancel what no longer holds a slot", () => {
    expect(refusalFor("cancel", "cancelled")).toBe(
      "This reservation is already cancelled.",
    );
    expect(refusalFor("cancel", "deleted")).toBe(
      "This reservation is deleted, so there is nothing to cancel.",
    );
  });

  it("will not delete twice", () => {
    expect(refusalFor("delete", "deleted")).toBe(
      "This reservation is already deleted.",
    );
  });
});

describe("isTelegramWebhook", () => {
  it("accepts only the exact secret the webhook was registered with", () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
    expect(isTelegramWebhook(WEBHOOK_SECRET)).toBe(true);
    expect(isTelegramWebhook(`${WEBHOOK_SECRET}x`)).toBe(false);
    expect(isTelegramWebhook(WEBHOOK_SECRET.slice(1))).toBe(false);
    expect(isTelegramWebhook(WEBHOOK_SECRET.toUpperCase())).toBe(false);
    expect(isTelegramWebhook("")).toBe(false);
    expect(isTelegramWebhook(null)).toBe(false);
  });

  it.each([
    ["unset", undefined],
    ["blank", "   "],
  ] as const)("refuses every caller while the secret is %s", (_s, value) => {
    if (value !== undefined) vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", value);
    expect(isTelegramWebhook(WEBHOOK_SECRET)).toBe(false);
    expect(isTelegramWebhook("")).toBe(false);
    expect(isTelegramWebhook(null)).toBe(false);
  });
});

describe("changeAnswer", () => {
  const reservation = (over: Partial<Reservation> = {}): Reservation => ({
    id: "36added1-cecc-494d-bce9-1809dd7eb4b2",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    boothId: "booth-1",
    startsAt: "2026-07-16T09:30",
    endsAt: "2026-07-16T11:00",
    status: "confirmed",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...over,
  });

  it("says an approval's confirmation went out, and to whom", () => {
    expect(
      changeAnswer({ reservation: reservation(), email: "sent" }, "approve"),
    ).toBe(
      "Approved: Ada Lovelace\nThe confirmation email was sent to ada@example.com.",
    );
  });

  it("says a cancellation went out, and to whom", () => {
    expect(
      changeAnswer(
        { reservation: reservation({ status: "cancelled" }), email: "sent" },
        "cancel",
      ),
    ).toBe(
      "Cancelled: Ada Lovelace\nThe cancellation email was sent to ada@example.com.",
    );
  });

  it("admits when the email could not be sent", () => {
    expect(
      changeAnswer({ reservation: reservation(), email: "failed" }, "approve"),
    ).toBe("Approved: Ada Lovelace\nThe confirmation email could not be sent.");
    expect(
      changeAnswer(
        { reservation: reservation({ status: "cancelled" }), email: "failed" },
        "cancel",
      ),
    ).toBe(
      "Cancelled: Ada Lovelace\nThe cancellation email could not be sent.",
    );
  });

  it("says so when no email was attempted at all", () => {
    expect(
      changeAnswer({ reservation: reservation(), email: "skipped" }, "approve"),
    ).toBe("Approved: Ada Lovelace\nNo confirmation email was sent.");
    expect(
      changeAnswer(
        { reservation: reservation({ status: "cancelled" }), email: "skipped" },
        "cancel",
      ),
    ).toBe("Cancelled: Ada Lovelace\nNo cancellation email was sent.");
  });

  it("mentions no email for a delete, which never sends one", () => {
    expect(
      changeAnswer(
        { reservation: reservation({ status: "deleted" }), email: "skipped" },
        "delete",
      ),
    ).toBe("Deleted: Ada Lovelace");
  });

  it("falls back to the address, then to plain words, for a nameless one", () => {
    const deleted = (over: Partial<Reservation>) =>
      changeAnswer(
        {
          reservation: reservation({ status: "deleted", ...over }),
          email: "skipped",
        },
        "delete",
      );
    expect(deleted({ fullName: "  " })).toBe("Deleted: ada@example.com");
    expect(deleted({ fullName: undefined, email: undefined })).toBe(
      "Deleted: the guest",
    );
  });
});
