// A member's own bookings: env-free, so the dialog and the routes share one rule.
import { isActiveStatus, type ReservationStatus } from "./types";

export type BookingPhase = "upcoming" | "ongoing" | "past";

/** All three are local wall-clock strings, which compare as plain text. */
export function phaseOf(
  startsAt: string,
  endsAt: string,
  now: string,
): BookingPhase {
  if (now < startsAt) return "upcoming";
  if (now < endsAt) return "ongoing";
  return "past";
}

export interface MyBooking {
  id: string;
  boothName: string;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  phase: BookingPhase;
  /** ISO time the request was made, shown as "Booked on". */
  createdAt: string;
  note?: string;
}

export function canCancel(b: Pick<MyBooking, "status" | "phase">): boolean {
  return isActiveStatus(b.status) && b.phase === "upcoming";
}

export function canChangeEnd(b: Pick<MyBooking, "status" | "phase">): boolean {
  return isActiveStatus(b.status) && b.phase === "ongoing";
}

/** The first grid step after now that still leaves the booking its minimum length. */
export function earliestEndMin(
  startMin: number,
  nowMin: number,
  stepMin: number,
  minDurationMin: number,
): number {
  const nextStep = Math.floor(nowMin / stepMin) * stepMin + stepMin;
  return Math.max(startMin + minDurationMin, nextStep);
}

// One wording for the refusals the dialog and the routes both give.
export const NOT_FOUND_MESSAGE = "That booking was not found.";
export const NOT_ACTIVE_MESSAGE = "That booking is no longer active.";
export const CANCEL_STARTED_MESSAGE =
  "A booking that has already started can't be cancelled.";
export const END_ONLY_ONGOING_MESSAGE =
  "Only a booking that is under way can change its end time.";
export const END_NOT_LATER_MESSAGE = "The new end time must be later than now.";

export function longStayMessage(hours: number, needsApproval: boolean): string {
  const why = needsApproval ? "needs admin approval" : "needs a note";
  return `A stay of ${hours} hours or more ${why}, so it can't be extended here. Reserve the extra time from the form instead.`;
}
