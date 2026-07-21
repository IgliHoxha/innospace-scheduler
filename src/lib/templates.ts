// Pure email/display helpers shared by the mailer and the dashboard preview,
// so the preview matches what's actually sent.
import type { ContactInfo, Reservation, ReservationStatus } from "./types";
import { boothName } from "./booths";
import { rangeLabel, dateOf } from "./schedule";
import { formatDateLong } from "./date-format";

export type EmailStatus = Extract<
  ReservationStatus,
  "confirmed" | "cancelled" | "pending"
>;

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

export function emailSubject(
  status: EmailStatus,
  contact: ContactInfo,
  r?: Reservation,
): string {
  const booth = r ? boothLabel(r) : "meeting booth";
  if (status === "cancelled")
    return `Update on your ${booth} booking at ${contact.org}`;
  if (status === "pending")
    return `We received your ${booth} booking request at ${contact.org}`;
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

// The canonical email sign-off: "Best regards," + who signs off, the org, and the
// contact rows. Shared by every email so they all close the same way. Every field
// is required (from env), so the whole block always renders.
export function signOff(contact: ContactInfo): string[] {
  return [
    "Best regards,",
    contact.name,
    "",
    contact.org,
    "",
    `Phone: ${contact.phone}`,
    `Email: ${contact.email}`,
  ];
}

function confirmedBody(r: Reservation, contact: ContactInfo): string {
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
  );
  lines.push(...signOff(contact));
  return lines.join("\n");
}

function cancelledBody(r: Reservation, contact: ContactInfo): string {
  const first = r.fullName?.trim() ? r.fullName.trim().split(" ")[0] : "";
  const greeting = first ? `Hello ${first},` : "Hello,";
  return [
    greeting,
    "",
    `Thank you for booking a meeting booth at ${contact.org}.`,
    "",
    `We're sorry to let you know that your booking for ${boothLabel(r)} on ${dateText(
      r,
    )} (${timeText(r)}) has been cancelled.`,
    "",
    "We sincerely apologize for the inconvenience. Please feel free to book another slot at your convenience, or reply to this email and we'll be glad to help.",
    "",
    ...signOff(contact),
  ].join("\n");
}

function pendingBody(r: Reservation, contact: ContactInfo): string {
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
    ...signOff(contact),
  ].join("\n");
}

// Editable body shown in the dashboard textarea; subject/shell added by the mailer.
export function emailBodyText(
  r: Reservation,
  status: EmailStatus,
  contact: ContactInfo,
): string {
  if (status === "confirmed") return confirmedBody(r, contact);
  if (status === "pending") return pendingBody(r, contact);
  return cancelledBody(r, contact);
}
