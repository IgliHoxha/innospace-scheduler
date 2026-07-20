// Kafka producer skeleton. Feature-flagged by KAFKA_BROKERS: while it's unset,
// publishing is a no-op (returns immediately), so the app runs unchanged until a
// broker is configured - the same pattern as the Resend mailer and Turnstile.
//
// Publishing is best-effort and must never block or fail a request: callers wrap
// it in the fire-and-forget `publishEvent`, which swallows errors after logging.
import type { Producer } from "kafkajs";
import { EVENTS, reservationEventData } from "./events";
import type {
  EventEnvelope,
  EventName,
  MemberInvitedData,
  ReservationEventData,
} from "./events";
import type { Reservation } from "./types";

function brokers(): string[] {
  return (process.env.KAFKA_BROKERS || "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
}

/** True once KAFKA_BROKERS is set - otherwise every publish is a no-op. */
export function isKafkaEnabled(): boolean {
  return brokers().length > 0;
}

function topicFor(event: EventName): string {
  return `${process.env.KAFKA_TOPIC_PREFIX || "scheduler."}${event}`;
}

// Lazy singleton producer, connected on first publish. Kept out of module scope
// so importing this file (e.g. during `next build`) never opens a socket.
let _producer: Producer | null = null;
let _connecting: Promise<Producer> | null = null;

async function getProducer(): Promise<Producer> {
  if (_producer) return _producer;
  if (_connecting) return _connecting;

  _connecting = (async () => {
    // Imported lazily so kafkajs is only loaded when actually publishing.
    const { Kafka, logLevel } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID || "innospace-scheduler",
      brokers: brokers(),
      ssl: process.env.KAFKA_SSL === "true" || undefined,
      logLevel: logLevel.NOTHING,
    });
    const producer = kafka.producer();
    await producer.connect();
    _producer = producer;
    return producer;
  })();

  try {
    return await _connecting;
  } finally {
    _connecting = null;
  }
}

/**
 * Publish an event. No-op when Kafka is disabled; otherwise best-effort - errors
 * are logged, never thrown, so a broker hiccup can't break a booking. `key`
 * (e.g. the reservation id) keeps a stream of events for one entity ordered.
 */
export async function publishEvent<T>(
  event: EventName,
  data: T,
  key?: string,
): Promise<void> {
  if (!isKafkaEnabled()) return;
  const envelope: EventEnvelope<T> = {
    event,
    occurredAt: new Date().toISOString(),
    data,
  };
  try {
    const producer = await getProducer();
    await producer.send({
      topic: topicFor(event),
      messages: [{ key, value: JSON.stringify(envelope) }],
    });
  } catch (err) {
    console.error(`[kafka] failed to publish ${event}:`, err);
  }
}

// ---- Typed convenience wrappers for the events we emit today ---------------

export function publishReservationEvent(
  event: Extract<
    EventName,
    "reservation.created" | "reservation.approved" | "reservation.cancelled"
  >,
  reservation: Reservation,
): Promise<void> {
  const data: ReservationEventData = reservationEventData(reservation);
  return publishEvent(event, data, reservation.id);
}

export function publishMemberInvited(data: MemberInvitedData): Promise<void> {
  return publishEvent(EVENTS.memberInvited, data, data.id);
}

/** Graceful shutdown for a standalone worker; the web app rarely needs it. */
export async function disconnectKafka(): Promise<void> {
  if (_producer) {
    await _producer.disconnect();
    _producer = null;
  }
}
