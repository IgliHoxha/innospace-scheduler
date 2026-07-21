// Single source of truth for statuses: the type, API validators, and DB CHECK
// constraint all derive from this array.
export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "deleted",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

// Length caps for free-text input. Enforced server-side (the client mirrors them
// with maxLength) so nothing unbounded reaches the DB, and so a huge password
// can't burn CPU in scrypt.
export const MAX_NOTE = 500;
export const MAX_NAME = 80;
export const MAX_EMAIL = 254; // RFC 5321
export const MAX_PASSWORD = 200;
export const MIN_PASSWORD = 6;
export const MAX_EMAIL_BODY = 5000;

/** The slot fields a booking submits (identity is taken from the session). */
export interface ReservationInput {
  fullName?: string;
  email?: string;
  phoneNumber?: string;
  /** A booth id from booths.ts, e.g. "booth-1". */
  boothId?: string;
  /** Local start datetime, "YYYY-MM-DDTHH:MM" (e.g. "2026-07-16T09:30"). */
  startsAt?: string;
  /** Local end datetime, exclusive (e.g. "2026-07-16T11:00"). */
  endsAt?: string;
  note?: string;
  /** Id of the user (member) who booked, or "admin". */
  userId?: string;
}

export interface Reservation extends ReservationInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ReservationStatus;
}

/**
 * A member who can log in and schedule booths. The admin invites them by email;
 * the member sets their own name + password from the invite link. Until then
 * `name` is empty and `activated` is false (no password on file yet).
 */
export interface User {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  email: string;
  /** True once the member has completed the invite (set name + password). */
  activated: boolean;
}

/** User plus its stored password hash (empty until activated): never sent to the client. */
export interface UserRecord extends User {
  passwordHash: string;
}
