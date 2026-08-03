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
export const MAX_EMAIL_BODY = 5000;

/** The fields a reservation submits: the slot, plus who is booking it. */
export interface ReservationInput {
  /** The booker's first and last name joined (see guest.ts). */
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
  /** Legacy column from the account era; unset for every new booking. */
  userId?: string;
}

export interface Reservation extends ReservationInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ReservationStatus;
}

// The email-footer contact fields, every one required and read from env
// server-side (getContactFromEnv in env-app.ts), so a footer always renders
// complete. Also the dashboard's contact prop, hence no env access here.
export type ContactInfo = {
  name: string; // who signs off the confirmation
  org: string;
  phone: string;
  email: string;
  url: string; // business website, shown as the email footer link
};
