// Single source of truth for statuses: the type, API validators, and DB CHECK
// constraint all derive from this array.
export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "deleted",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

// Statuses that hold a slot: pending blocks the time exactly like confirmed.
// `satisfies` proves it's a subset of the canonical list, so it can't drift.
export const ACTIVE_STATUSES = [
  "confirmed",
  "pending",
] as const satisfies readonly ReservationStatus[];

// Length caps for free-text input. Enforced server-side (the client mirrors them
// with maxLength) so nothing unbounded reaches the DB, and so a huge password
// can't burn CPU in scrypt.
export const MAX_NOTE = 500;
export const MAX_NAME = 80;
export const MAX_EMAIL = 254; // RFC 5321
export const MAX_PASSWORD = 200;
export const MIN_PASSWORD = 6;
export const MAX_EMAIL_BODY = 5000;

/** The slot fields a reservation submits (identity is taken from the session). */
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
  /** Id of the user (member) who reserved, or "admin". */
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

// The email-footer contact fields. Any left unset is omitted from the footer.
// Populated from env server-side (getContactFromEnv in email.ts); also the shape
// of the dashboard's contact prop, so it stays client-safe (no env access here).
// Every field is required and comes from env (getContactFromEnv in env-app.ts):
// there are no defaults, so emails always render a complete contact block.
export type ContactInfo = {
  name: string; // who signs off the confirmation
  org: string;
  phone: string;
  email: string;
  url: string; // business website, shown as the email footer link
};
