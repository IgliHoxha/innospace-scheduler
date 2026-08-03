// Booking identity, shared verbatim by the form and the route handler so the two can't drift.
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

// Shape first: exactly one @, no whitespace, a dot-bearing domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// RFC 5321 part limits. The whole address is capped separately by MAX_EMAIL.
const MAX_LOCAL = 64;
const MAX_DOMAIN = 255;

// A domain label: alphanumeric, hyphens allowed inside but never at either end.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Reject only what is structurally impossible, never what merely looks unusual. */
export function emailProblem(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return "Please enter a valid email address.";

  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (local.length > MAX_LOCAL) return "That email address is too long.";
  if (domain.length > MAX_DOMAIN) return "That email address is too long.";
  // A dot may separate parts but can never open, close, or double up.
  if (email.includes("..") || local.startsWith(".") || local.endsWith("."))
    return "Please enter a valid email address.";

  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l)))
    return "Please check the part after the @ in your email.";
  // A TLD is always letters, so "example.c0m" and "example.123" are typos.
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1]))
    return "Please check the part after the @ in your email.";

  return null;
}

export function isValidEmail(value: string): boolean {
  return emailProblem(value) === null;
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
  // Both names: one word rarely identifies anyone in a shared space.
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
  const problem = emailProblem(email);
  if (problem) {
    return { ok: false, field: "email", error: problem };
  }

  return { ok: true, guest: { fullName, email } };
}
