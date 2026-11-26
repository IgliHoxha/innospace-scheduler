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
  page: number;
  pageSize: number;
  total: number;
  bookings: MyBooking[];
}

/** Only before it starts: once under way, the page offers ending it instead. */
export function canCancel(b: Pick<MyBooking, "status" | "phase">): boolean {
  return isActiveStatus(b.status) && b.phase === "upcoming";
}

/** Only while it runs: before that it is a cancel, after it there is nothing left to free. */
export function canEndNow(b: Pick<MyBooking, "status" | "phase">): boolean {
  return isActiveStatus(b.status) && b.phase === "ongoing";
}

// One wording for the refusals the dialog and the routes both give.
export const NOT_FOUND_MESSAGE = "That booking was not found.";
export const NOT_ACTIVE_MESSAGE = "That booking is no longer active.";
export const CANCEL_OVER_MESSAGE =
  "A booking that is already over can't be cancelled.";
export const END_ONLY_ONGOING_MESSAGE =
  "Only a booking that is under way can be ended early.";
