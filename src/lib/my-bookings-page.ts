// Server-only: one page of a member's bookings, for the /bookings page and its API alike.
import { reservationsForEmail } from "./db";
import { boothName } from "./booths";
import { nowDateTime } from "./datetime";
import { pageCount } from "./pagination";
import { minReservationMinutes, stepMinutes } from "./schedule";
import {
  MY_BOOKINGS_PAGE_SIZE,
  phaseOf,
  type MyBookingsPage,
} from "./my-bookings";

/** A page past the end lands on the last one, so a cancel on it never strands the reader. */
export function loadMyBookings(
  email: string,
  requested: number,
): MyBookingsPage {
  const now = nowDateTime();
  const pageSize = MY_BOOKINGS_PAGE_SIZE;
  const wanted = Number.isInteger(requested) && requested > 0 ? requested : 1;
  let page = wanted;
  let found = reservationsForEmail(email, now, page, pageSize);
  const last = pageCount(found.total, pageSize);
  if (page > last) {
    page = last;
    found = reservationsForEmail(email, now, page, pageSize);
  }
  return {
    now,
    stepMinutes: stepMinutes(),
    minMinutes: minReservationMinutes(),
    page,
    pageSize,
    total: found.total,
    bookings: found.reservations.map((r) => {
      const startsAt = r.startsAt ?? "";
      const endsAt = r.endsAt ?? "";
      return {
        id: r.id,
        boothName: boothName(r.boothId),
        startsAt,
        endsAt,
        status: r.status,
        phase: phaseOf(startsAt, endsAt, now),
        createdAt: r.createdAt,
        ...(r.note?.trim() ? { note: r.note.trim() } : {}),
      };
    }),
  };
}
