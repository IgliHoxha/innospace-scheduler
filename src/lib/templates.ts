// Pure email/display helpers shared by the mailer and the dashboard preview,
// so the preview matches what's actually sent.
import type { Reservation, ReservationStatus } from "./types";
import { boothName } from "./booths";
import { rangeLabel, dateOf } from "./schedule";

export type EmailStatus = Extract<
  ReservationStatus,
  "confirmed" | "cancelled" | "pending"
>;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

function parseYMD(v: string | undefined) {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** Compact DD/MM/YY for the dashboard table, e.g. "14/07/26". */
export function formatDMYShort(value: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "-";
}

/** "Monday, 14 July 2026" for a YYYY-MM-DD. Timezone-free (parses the parts). */
export function formatDateLong(value: string | undefined): string {
  const p = parseYMD(value);
  if (!p) return "your requested date";
  // Zeller-free weekday: build a UTC date purely from the parts.
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Mon, 14 Jul" for a YYYY-MM-DD: compact label for the date picker. */
export function formatDateMedium(value: string | undefined): string {
  const p = parseYMD(value);
  if (!p) return "";
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${WEEKDAYS_SHORT[wd]}, ${p.d} ${MONTHS_SHORT[p.m - 1]}`;
}

/** The booked time range as text, e.g. "09:30 – 11:00". */
export function timeText(reservation: Reservation): string {
  if (!reservation.startsAt || !reservation.endsAt) return "-";
  return rangeLabel(reservation.startsAt, reservation.endsAt);
}

/** The booked day, YYYY-MM-DD, taken from the start datetime. */
export function dateOfReservation(
  reservation: Reservation,
): string | undefined {
  return reservation.startsAt ? dateOf(reservation.startsAt) : undefined;
}

/** "Monday, 14 July 2026" for a reservation's day. */
export function dateText(reservation: Reservation): string {
  return formatDateLong(dateOfReservation(reservation));
}

export function boothLabel(reservation: Reservation): string {
  return boothName(reservation.boothId);
}

/** One-line summary used in emails and the confirmation screen. */
export function reservationSummary(reservation: Reservation): string {
  return `${boothLabel(reservation)} · ${dateText(reservation)} · ${timeText(reservation)}`;
}

/**
 * Compact date + time for the "created at" column, e.g. "14/07/26 14:30".
 * Uses the local timezone, so call it client-side only (hydration-safe).
 */
export function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const yy = String(dt.getFullYear()).slice(2);
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${yy} ${pad2(
    dt.getHours(),
  )}:${pad2(dt.getMinutes())}`;
}

export function emailSubject(status: EmailStatus, r?: Reservation): string {
  const booth = r ? boothLabel(r) : "meeting booth";
  if (status === "cancelled")
    return `Update on your ${booth} booking at Innospace`;
  if (status === "pending")
    return `We received your ${booth} booking request at Innospace`;
  const date = r ? dateText(r) : "";
  return `Your ${booth} booking is confirmed${date ? ` for ${date}` : ""}`;
}

export function emailHeading(status: EmailStatus): string {
  if (status === "confirmed") return "Booking confirmed";
  if (status === "pending") return "Booking request received";
  return "Booking cancelled";
}

function firstName(r: Reservation): string {
  return r.fullName?.trim() ? r.fullName.trim().split(" ")[0] : "there";
}

// Real contact/access details live in env, not in this (public) source. Any
// field left unset is simply omitted from the email footer.
export type ContactInfo = {
  name?: string; // who signs off the confirmation
  org?: string;
  address?: string;
  accessApt1?: string;
  accessApt2?: string;
  mapsUrl?: string;
  phone?: string;
  email?: string;
  nid?: string;
};

// Server-only: BUSINESS_* / EMAIL_SIGNOFF_NAME aren't exposed to the browser.
export function getContactFromEnv(): ContactInfo {
  return {
    name: process.env.EMAIL_SIGNOFF_NAME,
    org: process.env.BUSINESS_NAME,
    address: process.env.BUSINESS_ADDRESS,
    accessApt1: process.env.BUSINESS_ACCESS_APT1,
    accessApt2: process.env.BUSINESS_ACCESS_APT2,
    mapsUrl: process.env.BUSINESS_MAPS_URL,
    phone: process.env.BUSINESS_PHONE,
    email: process.env.BUSINESS_EMAIL,
    nid: process.env.BUSINESS_NID,
  };
}

// Sign-off + contact/access block for the confirmation email. Built from env, so
// only the details actually configured appear.
function signOff(contact?: ContactInfo): string[] {
  const c = contact ?? {};
  const lines: string[] = [];
  if (c.name) lines.push(c.name);
  lines.push("", c.org || "InnoSpace Tirana");
  if (c.address) lines.push(c.address);
  const access = [c.accessApt1, c.accessApt2].filter(Boolean) as string[];
  if (access.length) {
    lines.push("", "⚠️ Important access instructions:");
    for (const a of access) lines.push("", a);
  }
  if (c.mapsUrl) lines.push("", `View on Google Maps: ${c.mapsUrl}`);
  const rows: string[] = [];
  if (c.phone) rows.push(`Phone: ${c.phone}`);
  if (c.email) rows.push(`Email: ${c.email}`);
  if (c.nid) rows.push(`NID: ${c.nid}`);
  if (rows.length) lines.push("", ...rows);
  return lines;
}

function confirmedBody(r: Reservation, contact?: ContactInfo): string {
  const lines = [
    `Hi ${firstName(r)},`,
    "",
    `Your meeting booth is booked. Here are the details:`,
    "",
    `Booth: ${boothLabel(r)}`,
    `Date: ${dateText(r)}`,
    `Time: ${timeText(r)}`,
  ];
  if (r.note?.trim()) lines.push(`Note: ${r.note.trim()}`);
  lines.push(
    "",
    "If you need to change or cancel, just reply to this email.",
    "",
    "Best regards,",
  );
  lines.push(...signOff(contact));
  return lines.join("\n");
}

function cancelledBody(r: Reservation): string {
  const first = r.fullName?.trim() ? r.fullName.trim().split(" ")[0] : "";
  const greeting = first ? `Hello ${first},` : "Hello,";
  return [
    greeting,
    "",
    "Thank you for booking a meeting booth at InnoSpace Tirana.",
    "",
    `We're sorry to let you know that your booking for ${boothLabel(r)} on ${dateText(
      r,
    )} (${timeText(r)}) has been cancelled.`,
    "",
    "We sincerely apologize for the inconvenience. Please feel free to book another slot at your convenience, or reply to this email and we'll be glad to help.",
    "",
    "Best regards,",
    "InnoSpace Tirana",
  ].join("\n");
}

function pendingBody(r: Reservation): string {
  return [
    `Hi ${firstName(r)},`,
    "",
    "Thanks for your booking request. Because it's longer than our instant-booking limit, it needs a quick review by our team before it's confirmed. Here's what you requested:",
    "",
    `Booth: ${boothLabel(r)}`,
    `Date: ${dateText(r)}`,
    `Time: ${timeText(r)}`,
    ...(r.note?.trim() ? [`Note: ${r.note.trim()}`] : []),
    "",
    "We'll email you again as soon as it's approved or if we need to make a change. The slot is held for you in the meantime.",
    "",
    "Best regards,",
    "InnoSpace Tirana",
  ].join("\n");
}

// Editable body shown in the dashboard textarea; subject/shell added by the mailer.
export function emailBodyText(
  r: Reservation,
  status: EmailStatus,
  contact?: ContactInfo,
): string {
  if (status === "confirmed") return confirmedBody(r, contact);
  if (status === "pending") return pendingBody(r);
  return cancelledBody(r);
}
