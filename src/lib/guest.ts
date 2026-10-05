// Shared verbatim by the form and the route, so neither drifts.
import { MAX_EMAIL, MAX_NAME } from "./types";

export interface GuestInput {
  fullName?: unknown;
  email?: unknown;
}

export interface Guest {
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

/** Rejects only the structurally impossible, never the merely unusual. */
function emailProblem(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return "Please enter a valid email address.";

  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (local.length > MAX_LOCAL) return "That email address is too long.";
  if (domain.length > MAX_DOMAIN) return "That email address is too long.";
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

// googlemail.com is the same inbox as gmail.com.
const DOMAIN_ALIASES = new Map([["googlemail.com", "gmail.com"]]);

// Gmail alone ignores dots; everyone else treats them as part of the address.
const IGNORES_DOTS = new Set(["gmail.com"]);

// Providers where "+tag" is the same inbox, so a tag buys no second identity.
const IGNORES_PLUS_TAG = new Set([
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "fastmail.com",
]);

/** One mailbox, one identity: what limits count, never what we send to. */
export function canonicalEmail(value: string): string {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;

  let local = email.slice(0, at);
  const raw = email.slice(at + 1);
  const domain = DOMAIN_ALIASES.get(raw) ?? raw;

  if (IGNORES_PLUS_TAG.has(domain)) {
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
  }
  if (IGNORES_DOTS.has(domain)) local = local.replaceAll(".", "");

  // An all-dots or bare "+tag" local part canonicalises to nothing, so keep it.
  return local ? `${local}@${domain}` : email;
}

const clean = (v: unknown): string =>
  typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";

function nameProblem(fullName: string): string | null {
  if (!fullName) return "Please enter your full name.";
  // Both names: one word rarely identifies anyone in a shared space.
  if (!fullName.includes(" ")) return "Please enter your first and last name.";
  if (fullName.length > MAX_NAME)
    return `Your name must be ${MAX_NAME} characters or fewer.`;
  return null;
}

function guestEmailProblem(email: string): string | null {
  if (!email) return "Please enter your email.";
  if (email.length > MAX_EMAIL) return "That email address is too long.";
  return emailProblem(email);
}

export function validateGuest(input: GuestInput): GuestResult {
  const fullName = clean(input.fullName);
  const email = clean(input.email).toLowerCase();

  const nameError = nameProblem(fullName);
  if (nameError) return { ok: false, field: "fullName", error: nameError };
  const emailError = guestEmailProblem(email);
  if (emailError) return { ok: false, field: "email", error: emailError };

  return { ok: true, guest: { fullName, email } };
}

/** Every failing field, not just the first, so the form can mark them all. */
export function guestProblems(
  input: GuestInput,
): Partial<Record<GuestField, string>> {
  const nameError = nameProblem(clean(input.fullName));
  const emailError = guestEmailProblem(clean(input.email).toLowerCase());

  const problems: Partial<Record<GuestField, string>> = {};
  if (nameError) problems.fullName = nameError;
  if (emailError) problems.email = emailError;
  return problems;
}
