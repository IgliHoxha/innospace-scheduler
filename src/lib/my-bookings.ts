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

// Ten cards fill a screen or two; the dashboard's 25 rows are one line each.
export const MY_BOOKINGS_PAGE_SIZE = 10;

/** What the /bookings page shows, and what its API answers for any page. */
export interface MyBookingsPage {
  /** The server's clock, so the page sorts bookings as the routes will judge them. */
  now: string;
  stepMinutes: number;
  minMinutes: number;
  page: number;
  pageSize: number;
  total: number;
  bookings: MyBooking[];
}

/** Until it is over: a booking under way can be dropped too, freeing the rest of its time. */
export function canCancel(b: Pick<MyBooking, "status" | "phase">): boolean {
  return isActiveStatus(b.status) && b.phase !== "past";
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
export const CANCEL_OVER_MESSAGE =
  "A booking that is already over can't be cancelled.";
export const END_ONLY_ONGOING_MESSAGE =
  "Only a booking that is under way can change its end time.";
export const END_NOT_LATER_MESSAGE = "The new end time must be later than now.";

export function longStayMessage(hours: number, needsApproval: boolean): string {
  const why = needsApproval ? "needs admin approval" : "needs a note";
  return `A stay of ${hours} hours or more ${why}, so it can't be extended here. Reserve the extra time from the form instead.`;
}
