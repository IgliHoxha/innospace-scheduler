// Booking identity for a login-less reservation. Shared verbatim by the form
// (inline feedback) and the route handler (the truth), so the two can't drift.
// No env or server imports: this has to be safe in the client bundle.
import { MAX_EMAIL, MAX_NAME } from "./types";

export interface GuestInput {
  fullName?: unknown;
  email?: unknown;
}

export interface Guest {
  /** First and last name, as stored in `reservations.fullName`. */
  fullName: string;
  email: string;
}

export type GuestField = "fullName" | "email";

export type GuestResult =
  { ok: true; guest: Guest } | { ok: false; field: GuestField; error: string };

// Deliberately permissive: one @, a dot-bearing domain, no spaces. Anything
// stricter starts rejecting addresses that are legal and deliverable.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

// Collapse runs of whitespace so "Ada   Lovelace" is stored as one clean name.
const clean = (v: unknown): string =>
  typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";

/** Validate and normalise a booker's details. */
export function validateGuest(input: GuestInput): GuestResult {
  const fullName = clean(input.fullName);
  const email = clean(input.email).toLowerCase();

  if (!fullName) {
    return {
      ok: false,
      field: "fullName",
      error: "Please enter your full name.",
    };
  }
  // Both names: the admin needs to know who holds a booth, and one word rarely
  // identifies anyone in a shared space.
  if (!fullName.includes(" ")) {
    return {
      ok: false,
      field: "fullName",
      error: "Please enter your first and last name.",
    };
  }
  if (fullName.length > MAX_NAME) {
    return {
      ok: false,
      field: "fullName",
      error: `Your name must be ${MAX_NAME} characters or fewer.`,
    };
  }
  if (!email) {
    return { ok: false, field: "email", error: "Please enter your email." };
  }
  if (email.length > MAX_EMAIL) {
    return {
      ok: false,
      field: "email",
      error: "That email address is too long.",
    };
  }
  if (!isValidEmail(email)) {
    return {
      ok: false,
      field: "email",
      error: "Please enter a valid email address.",
    };
  }

  return { ok: true, guest: { fullName, email } };
}
