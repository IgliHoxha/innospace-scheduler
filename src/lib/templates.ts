// Shared by the mailer and the dashboard preview, so the preview matches.
import type { ContactInfo, Reservation, ReservationStatus } from "./types";
import { rangeLabel } from "./schedule";
import { dateOf, formatDateLong } from "./datetime";

export type EmailStatus = Extract<
  ReservationStatus,
  "confirmed" | "cancelled" | "pending"
>;

/** Booth id to name, injected: the env lookup would throw in a client bundle. */
export type BoothNamer = (boothId: string | undefined) => string;

/** The reserved time range as text, e.g. "09:30 - 11:00". */
export function timeText(reservation: Reservation): string {
  if (!reservation.startsAt || !reservation.endsAt) return "-";
  return rangeLabel(reservation.startsAt, reservation.endsAt);
}

/** The reserved day, YYYY-MM-DD, taken from the start datetime. */
export function dateOfReservation(
  reservation: Reservation,
): string | undefined {
  return reservation.startsAt ? dateOf(reservation.startsAt) : undefined;
}

/** "Monday, 14 July 2026" for a reservation's day. */
export function dateText(reservation: Reservation): string {
  return formatDateLong(dateOfReservation(reservation));
}

export function boothLabel(
  reservation: Reservation,
  boothName: BoothNamer,
): string {
  return boothName(reservation.boothId);
}

/** One-line summary used in emails and the confirmation screen. */
export function reservationSummary(
  reservation: Reservation,
  boothName: BoothNamer,
): string {
  return `${boothLabel(reservation, boothName)} · ${dateText(reservation)} · ${timeText(reservation)}`;
}

export function emailSubject(
  status: EmailStatus,
  contact: ContactInfo,
  boothName: BoothNamer,
  r?: Reservation,
): string {
  const booth = r ? boothLabel(r, boothName) : "meeting booth";
  if (status === "cancelled")
    return `Update on your ${booth} reservation at ${contact.org}`;
  if (status === "pending")
    return `We received your ${booth} reservation request at ${contact.org}`;
  const date = r ? dateText(r) : "";
  return `Your ${booth} reservation is confirmed${date ? ` for ${date}` : ""}`;
}

/** The snippet under the subject; without one a client scrapes the wordmark. */
export function emailPreheader(
  r: Reservation,
  status: EmailStatus,
  contact: ContactInfo,
  boothName: BoothNamer,
): string {
  const where = `${reservationSummary(r, boothName)} at ${contact.org}.`;
  if (status === "cancelled")
    return `Cancelled: ${where} You can reserve another slot whenever suits you.`;
  if (status === "pending")
    return `Awaiting approval: ${where} The slot is held for you meanwhile.`;
  return `Confirmed: ${where} Your cancel link is inside if your plans change.`;
}

export function emailHeading(status: EmailStatus): string {
  if (status === "confirmed") return "Reservation confirmed";
  if (status === "pending") return "Reservation request received";
  return "Reservation cancelled";
}

function firstName(r: Reservation): string {
  return r.fullName?.trim() ? r.fullName.trim().split(" ")[0] : "there";
}

// The one sign-off every email closes with; EMAIL_SIGNOFF_NAME carries the org.
export function signOff(contact: ContactInfo): string[] {
  return [
    "Best regards,",
    contact.name,
    "",
    `Phone: ${contact.phone}`,
    `Email: ${contact.email}`,
  ];
}

function confirmedBody(
  r: Reservation,
  contact: ContactInfo,
  boothName: BoothNamer,
): string {
  const lines = [
    `Hi ${firstName(r)},`,
    "",
    `Your meeting booth is reserved. Here are the details:`,
    "",
    `Booth: ${boothLabel(r, boothName)}`,
    `Date: ${dateText(r)}`,
    `Time: ${timeText(r)}`,
  ];
  if (r.note?.trim()) lines.push(`Note: ${r.note.trim()}`);
  lines.push(
    "",
    "If your plans change, use the cancel link at the bottom of this email, or just reply to it.",
    "",
  );
  lines.push(...signOff(contact));
  return lines.join("\n");
}

function cancelledBody(
  r: Reservation,
  contact: ContactInfo,
  boothName: BoothNamer,
): string {
  const first = r.fullName?.trim() ? r.fullName.trim().split(" ")[0] : "";
  const greeting = first ? `Hello ${first},` : "Hello,";
  return [
    greeting,
    "",
    `Thank you for reserving a meeting booth at ${contact.org}.`,
    "",
    `We're sorry to let you know that your reservation for ${boothLabel(r, boothName)} on ${dateText(
      r,
    )} (${timeText(r)}) has been cancelled.`,
    "",
    "We sincerely apologize for the inconvenience. Please feel free to reserve another slot at your convenience, or reply to this email and we'll be glad to help.",
    "",
    ...signOff(contact),
  ].join("\n");
}

function pendingBody(
  r: Reservation,
  contact: ContactInfo,
  boothName: BoothNamer,
): string {
  return [
    `Hi ${firstName(r)},`,
    "",
    "Thanks for your reservation request. Because it's longer than our instant-reservation limit, it needs a quick review by our team before it's confirmed. Here's what you requested:",
    "",
    `Booth: ${boothLabel(r, boothName)}`,
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
  boothName: BoothNamer,
): string {
  if (status === "confirmed") return confirmedBody(r, contact, boothName);
  if (status === "pending") return pendingBody(r, contact, boothName);
  return cancelledBody(r, contact, boothName);
}
