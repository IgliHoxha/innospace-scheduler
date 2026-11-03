import { formatDateLong } from "./datetime";
import { repeatLabel } from "./recurrence";

export interface BookingWhen {
  boothName: string;
  date: string;
  start: string;
  end: string;
  repeatWeeks: number;
}

/** The booking named in full, for a success or a failure that outlived its form. */
export function bookingWhen(b: BookingWhen): string {
  const weekly = b.repeatWeeks > 1 ? `, ${repeatLabel(b.repeatWeeks)}` : "";
  return `${b.boothName} on ${formatDateLong(b.date)}, ${b.start} - ${b.end}${weekly}`;
}

export function bookedMessage(o: {
  when: string;
  pending: boolean;
  repeatWeeks: number;
  autoApproveMaxHours: number;
  email: string;
}): string {
  if (!o.pending) {
    return `Reserved ${o.when}. We've emailed ${o.email} a confirmation, with a link to cancel if your plans change.`;
  }
  const held = o.repeatWeeks > 1 ? "The slots are" : "The slot is";
  return `Request submitted: ${o.when}. Reservations over ${o.autoApproveMaxHours} hours need admin approval - we'll email you once it's reviewed. ${held} held for you meanwhile.`;
}
