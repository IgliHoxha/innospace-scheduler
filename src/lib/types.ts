// Single source of truth for statuses: the type, validators and DB CHECK all derive from this.
export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "deleted",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

// Statuses that hold a slot; `satisfies` proves it's a subset of the canonical list.
export const ACTIVE_STATUSES = [
  "confirmed",
  "pending",
] as const satisfies readonly ReservationStatus[];

// Length caps for free text, enforced server-side so nothing unbounded reaches the DB.
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
  /** A booth id from booths.ts, e.g. "booth-1". */
  boothId?: string;
  /** Local start datetime, "YYYY-MM-DDTHH:MM" (e.g. "2026-07-16T09:30"). */
  startsAt?: string;
  /** Local end datetime, exclusive (e.g. "2026-07-16T11:00"). */
  endsAt?: string;
  note?: string;
}

export interface Reservation extends ReservationInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ReservationStatus;
}

// Email-footer contact fields, all required from env, so a footer always renders complete.
export type ContactInfo = {
  name: string; // who signs off the confirmation
  org: string;
  phone: string;
  email: string;
  url: string; // business website, shown as the email footer link
};
