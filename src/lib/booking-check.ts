// The browser's mirror of the route's rules, in its order. Minutes throughout.
import {
  approvalRequiredFor,
  findOverlap,
  isBookableMinute,
  meetsMinDuration,
  noteRequiredFor,
  runTotalMinutes,
} from "./reservation-rules";

/** Where a problem belongs; "note" at the note box, the rest by the button. */
export type ProblemField = "note";

export interface BookingCheck {
  /** Booked minutes of the run this joins, 0 until both ends are chosen. */
  runMinutes: number;
  /** Longer than this booking alone, so the wording must explain why. */
  partOfRun: boolean;
  /** A note is required at this run length. */
  mustNote: boolean;
  /** Over the limit, so an admin has to approve it. */
  needsApproval: boolean;
  /** The blocking problem, empty when there is none. */
  problem: string;
  /** Set only when the problem belongs at a named field. */
  field?: ProblemField;
}

export interface BookingCheckInput {
  /** Null until that end is chosen; nothing is judged before both are. */
  startMin: number | null;
  endMin: number | null;
  openMin: number;
  closeMin: number;
  /** First still-reservable minute today, so a passed slot can be named as such. */
  earliestMin: number;
  reserved: readonly { start: number; end: number; label: string }[];
  /** Other bookings the board confirms; the server counts every booth. */
  held: readonly { start: number; end: number }[];
  note: string;
  stepMinutes: number;
  minReservationMinutes: number;
  autoApproveMaxHours: number;
}

/** Does this problem block the reserve button, or wait for the press? */
export function isBlocking(check: BookingCheck): boolean {
  // A missing note is about a field not reached yet, not the times chosen.
  return !!check.problem && check.field !== "note";
}

/** The note-required message, worded for whether a run pushed it over. */
export function noteRequiredMessage(
  partOfRun: boolean,
  autoApproveMaxHours: number,
): string {
  return partOfRun
    ? `Please say what the reservation is for - back to back with your other bookings this comes to ${autoApproveMaxHours} hours or more.`
    : `Please say what the reservation is for - a note is required for ${autoApproveMaxHours} hours or more.`;
}

/** Every route check the browser can make, so the form cannot submit a rejection. */
export function checkBooking(input: BookingCheckInput): BookingCheck {
  const {
    startMin,
    endMin,
    openMin,
    closeMin,
    earliestMin,
    reserved,
    held,
    note,
    stepMinutes,
    minReservationMinutes,
    autoApproveMaxHours,
  } = input;

  const chosen = startMin != null && endMin != null;
  const duration = chosen ? endMin - startMin : 0;
  const runMinutes =
    chosen && duration > 0
      ? // One sitting spans the shortest bookable gap: nobody could take it.
        runTotalMinutes(startMin, endMin, held, minReservationMinutes)
      : 0;
  const partOfRun = runMinutes > duration;
  const mustNote = noteRequiredFor(runMinutes, autoApproveMaxHours);
  const base = {
    runMinutes,
    partOfRun,
    mustNote,
    needsApproval: approvalRequiredFor(runMinutes, autoApproveMaxHours),
  };
  const no = (problem: string, field?: ProblemField) => ({
    ...base,
    problem,
    field,
  });

  if (!chosen) return no("");
  if (
    !isBookableMinute(startMin, openMin, closeMin, stepMinutes) ||
    !isBookableMinute(endMin, openMin, closeMin, stepMinutes)
  )
    return no(
      `Please choose times within opening hours, in ${stepMinutes}-minute steps.`,
    );
  if (endMin <= startMin)
    return no("The end time must be after the start time.");
  if (!meetsMinDuration(duration, minReservationMinutes))
    return no(
      `Reservations must be at least ${minReservationMinutes} minutes long.`,
    );
  if (startMin < earliestMin) return no("That time has already passed.");

  const clash = findOverlap(startMin, endMin, reserved);
  if (clash)
    return no(`That overlaps an existing reservation (${clash.label}).`);
  // The server rejects two booths at once; this browser knows its own.
  if (findOverlap(startMin, endMin, held))
    return no("You already have a reservation during that time.");

  if (mustNote && !note.trim())
    return no(noteRequiredMessage(partOfRun, autoApproveMaxHours), "note");
  return no("");
}
