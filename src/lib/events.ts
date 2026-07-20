// Domain events emitted by the scheduler. These are the messages published to
// Kafka (see kafka.ts) and, later, anything else that wants to react to booking
// activity. Kept transport-agnostic: just names + typed payloads.
import type { Reservation } from "./types";

/** Event names. The Kafka topic is `${KAFKA_TOPIC_PREFIX}${name}` (dots kept). */
export const EVENTS = {
  reservationCreated: "reservation.created",
  reservationApproved: "reservation.approved",
  reservationCancelled: "reservation.cancelled",
  memberInvited: "member.invited",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** What every event carries. `occurredAt` is set by the publisher. */
export interface EventEnvelope<T> {
  event: EventName;
  occurredAt: string; // ISO-8601
  data: T;
}

export interface ReservationEventData {
  id: string;
  boothId?: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
  userId?: string;
  email?: string;
}

export interface MemberInvitedData {
  id: string;
  email: string;
}

/** Project a Reservation down to the fields an event should carry (no PII beyond email). */
export function reservationEventData(r: Reservation): ReservationEventData {
  return {
    id: r.id,
    boothId: r.boothId,
    status: r.status,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    userId: r.userId,
    email: r.email,
  };
}
