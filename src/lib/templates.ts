// Shared by the mailer and the dashboard preview, so the preview matches.
import type {
  Booth,
  ContactInfo,
  Reservation,
  ReservationStatus,
} from "./types";
import { dateOf, formatDateLong, rangeLabel } from "./datetime";
import { seriesHeading } from "./recurrence";

export type EmailStatus = Extract<
  ReservationStatus,
  "confirmed" | "cancelled" | "pending"
>;

/** Injected: the env lookup would throw in a client bundle. */
export type BoothNamer = (boothId: string | undefined) => string;

/** Client-safe: the booth list is supplied, so there is no env read. */
export function boothNameIn(booths: Booth[], id: string | undefined): string {
  if (!id) return "Booth";
  return booths.find((b) => b.id === id)?.name ?? id;
}

export function timeText(reservation: Reservation): string {
  if (!reservation.startsAt || !reservation.endsAt) return "-";
  return rangeLabel(reservation.startsAt, reservation.endsAt);
}

export function dateOfReservation(
  reservation: Reservation,
): string | undefined {
  return reservation.startsAt ? dateOf(reservation.startsAt) : undefined;
}

export function dateText(reservation: Reservation): string {
  return formatDateLong(dateOfReservation(reservation));
}

export function boothLabel(
  reservation: Reservation,
  boothName: BoothNamer,
): string {
  return boothName(reservation.boothId);
}

export function reservationSummary(
  reservation: Reservation,
  boothName: BoothNamer,
): string {
  return `${boothLabel(reservation, boothName)} · ${dateText(reservation)} · ${timeText(reservation)}`;
}

/** Two or more dates of one weekly repeat; a single booking passes none. */
export type Series = readonly Reservation[];

const isSeries = (series?: Series): series is Series =>
  !!series && series.length > 1;

/** "Thursday, 16 July 2026" per date, in the order they were booked. */
export function seriesDates(series: Series): string[] {
  return series.map(dateText);
}

export function emailSubject(
  status: EmailStatus,
  contact: ContactInfo,
  boothName: BoothNamer,
  r?: Reservation,
  series?: Series,
): string {
  const booth = r ? boothLabel(r, boothName) : "meeting booth";
  const weekly = isSeries(series) ? " weekly" : "";
  if (status === "cancelled")
    return `Update on your ${booth} reservation at ${contact.org}`;
  if (status === "pending")
    return `We received your ${booth}${weekly} reservation request at ${contact.org}`;
  if (isSeries(series))
    return `Your ${booth} weekly reservation is confirmed (${series.length} dates)`;
  const date = r ? dateText(r) : "";
  return `Your ${booth} reservation is confirmed${date ? ` for ${date}` : ""}`;
}

/** The snippet under the subject; without one a client scrapes the wordmark. */
export function emailPreheader(
  r: Reservation,
  status: EmailStatus,
  contact: ContactInfo,
  boothName: BoothNamer,
  series?: Series,
): string {
  const when = isSeries(series)
    ? `every week from ${dateText(r)}`
    : dateText(r);
  const where = `${boothLabel(r, boothName)} · ${when} · ${timeText(r)} at ${contact.org}.`;
  // Long enough to fill the snippet alone, or a client scrapes the body.
  if (status === "cancelled")
    return `Cancelled: ${where} That slot is free again, and you can reserve another one whenever suits you.`;
  if (status === "pending")
    return `Awaiting approval: ${where} The slot is held for you meanwhile, and we will email you as soon as it is reviewed.`;
  return `Confirmed: ${where} Nothing else is needed from you, and a link to cancel is inside if your plans change.`;
}

export function emailHeading(status: EmailStatus): string {
  if (status === "confirmed") return "Reservation confirmed";
  if (status === "pending") return "Reservation request received";
  return "Reservation cancelled";
}

function firstName(r: Reservation): string {
  return r.fullName?.trim().split(" ")[0] ?? "";
}

function detailLines(
  r: Reservation,
  boothName: BoothNamer,
  series?: Series,
): string[] {
  const when = isSeries(series)
    ? [
        `Time: ${timeText(r)}`,
        `Dates: ${seriesHeading(series.map((s) => dateOfReservation(s) ?? ""))}`,
        ...seriesDates(series).map((d) => `- ${d}`),
      ]
    : [`Date: ${dateText(r)}`, `Time: ${timeText(r)}`];
  return [
    `Booth: ${boothLabel(r, boothName)}`,
    ...when,
    ...(r.note?.trim() ? [`Note: ${r.note.trim()}`] : []),
  ];
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
  series?: Series,
): string {
  return [
    `Hi ${firstName(r) || "there"},`,
    "",
    isSeries(series)
      ? "Your meeting booth is reserved every week. Here are the details:"
      : "Your meeting booth is reserved. Here are the details:",
    "",
    ...detailLines(r, boothName, series),
    "",
    isSeries(series)
      ? "If your plans change, the link at the bottom of this email cancels every date still ahead, or just reply to it."
      : "If your plans change, use the cancel link at the bottom of this email, or just reply to it.",
    "",
    ...signOff(contact),
  ].join("\n");
}

function cancelledBody(
  r: Reservation,
  contact: ContactInfo,
  boothName: BoothNamer,
): string {
  const first = firstName(r);
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
  series?: Series,
): string {
  return [
    `Hi ${firstName(r) || "there"},`,
    "",
    "Thanks for your reservation request. Because it's longer than our instant-reservation limit, it needs a quick review by our team before it's confirmed. Here's what you requested:",
    "",
    ...detailLines(r, boothName, series),
    "",
    isSeries(series)
      ? "We'll email you again as each date is approved or if we need to make a change. The slots are held for you in the meantime."
      : "We'll email you again as soon as it's approved or if we need to make a change. The slot is held for you in the meantime.",
    "",
    ...signOff(contact),
  ].join("\n");
}

// The editable body only; the mailer adds the subject and shell.
export function emailBodyText(
  r: Reservation,
  status: EmailStatus,
  contact: ContactInfo,
  boothName: BoothNamer,
  series?: Series,
): string {
  if (status === "confirmed")
    return confirmedBody(r, contact, boothName, series);
  if (status === "pending") return pendingBody(r, contact, boothName, series);
  return cancelledBody(r, contact, boothName);
}
