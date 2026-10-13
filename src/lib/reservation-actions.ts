// The dashboard's approve, cancel and delete, shared with the Telegram replies.
import { getReservation, updateReservationStatus } from "./db";
import { sendReservationEmail, type EmailOutcome } from "./email";
import { boothName } from "./booths";
import { postReservationToSlack } from "./slack";
import type { Reservation, ReservationStatus } from "./types";

export interface StatusChange {
  reservation: Reservation;
  /** "skipped" also covers a delete, which emails nobody. */
  email: EmailOutcome;
}

/** Null for a missing id; a failed email or Slack post never undoes the change. */
export async function changeReservationStatus(
  id: string,
  status: ReservationStatus,
  emailBody?: string,
): Promise<StatusChange | null> {
  // Only a pending row becomes an approval; sync reads cannot interleave.
  const before = getReservation(id);
  // One atomic UPDATE ... RETURNING: a separate existence read would race.
  const reservation = updateReservationStatus(id, status);
  if (!reservation) return null;

  let email: EmailOutcome = "skipped";
  if (status === "confirmed" || status === "cancelled") {
    try {
      email = await sendReservationEmail(reservation, status, emailBody);
    } catch (err) {
      console.error("[reservations] status email failed:", err);
      email = "failed";
    }
  }

  // The booking was announced when made, so only a verdict on it is news.
  if (status === "cancelled") {
    await postReservationToSlack(reservation, "cancelled", boothName, "admin");
  } else if (status === "confirmed" && before?.status === "pending") {
    await postReservationToSlack(reservation, "approved", boothName);
  }

  return { reservation, email };
}
