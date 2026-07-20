import { afterEach, describe, expect, it } from "vitest";
import { isKafkaEnabled, publishEvent } from "@/lib/kafka";
import { reservationEventData, EVENTS } from "@/lib/events";
import type { Reservation } from "@/lib/types";

afterEach(() => {
  delete process.env.KAFKA_BROKERS;
});

describe("kafka producer (disabled by default)", () => {
  it("isKafkaEnabled reflects KAFKA_BROKERS", () => {
    delete process.env.KAFKA_BROKERS;
    expect(isKafkaEnabled()).toBe(false);
    process.env.KAFKA_BROKERS = "localhost:9092";
    expect(isKafkaEnabled()).toBe(true);
    process.env.KAFKA_BROKERS = "  ,  ";
    expect(isKafkaEnabled()).toBe(false); // whitespace/empty entries don't count
  });

  it("publishEvent is a no-op that resolves when no broker is configured", async () => {
    delete process.env.KAFKA_BROKERS;
    // Must resolve (not throw, not hang) — never opens a connection.
    await expect(
      publishEvent(EVENTS.reservationCreated, { id: "r1" }, "r1"),
    ).resolves.toBeUndefined();
  });
});

describe("reservationEventData", () => {
  it("projects a reservation down to the event fields", () => {
    const r: Reservation = {
      id: "r1",
      createdAt: "2026-07-20T10:00:00.000Z",
      status: "confirmed",
      boothId: "booth-1",
      startsAt: "2026-07-21T10:00",
      endsAt: "2026-07-21T11:00",
      userId: "u1",
      email: "a@b.com",
      fullName: "Ada",
      note: "standup",
    };
    expect(reservationEventData(r)).toEqual({
      id: "r1",
      boothId: "booth-1",
      status: "confirmed",
      startsAt: "2026-07-21T10:00",
      endsAt: "2026-07-21T11:00",
      userId: "u1",
      email: "a@b.com",
    });
  });
});
