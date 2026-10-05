// The browser's mirror of the route's rules, in its order. Minutes throughout.
import {
  approvalRequiredFor,
  END_BEFORE_START_MESSAGE,
  findOverlap,
  isBookableMinute,
  meetsMinDuration,
  noteRequiredFor,
  offGridMessage,
  runTotalMinutes,
  TIME_PASSED_MESSAGE,
  tooShortMessage,
  USER_BUSY_MESSAGE,
} from "./reservation-rules";

/** Where a problem belongs; "note" at the note box, the rest by the button. */
export type ProblemField = "note";

export interface BookingCheck {
  /** Booked minutes of the run this joins, 0 until both ends are chosen. */
  runMinutes: number;
  /** Longer than this booking alone, so the wording must explain why. */
  partOfRun: boolean;
  mustNote: boolean;
  needsApproval: boolean;
  /** The blocking problem, empty when there is none. */
  problem: string;
  field?: ProblemField;
}

export interface BookingCheckInput {
  /** Null until that end is chosen; nothing is judged before both are. */
  startMin: number | null;
  endMin: number | null;
  /** First minute still reservable today. */
  earliestMin: number;
  reserved: readonly { start: number; end: number; label: string }[];
  /** Other bookings the board confirms; the server counts every booth. */
  held: readonly { start: number; end: number }[];
  note: string;
  stepMinutes: number;
  minReservationMinutes: number;
  autoApproveMaxHours: number;
}

/** Everything the server judges a booking on; the note is not part of it. */
export interface Attempt {
  boothId: string;
  date: string;
  start: string;
  end: string;
  /** The canonical email, since the run counted is that person's. */
  booker: string;
}

/** Keys a verdict to exactly the attempt that was judged. */
export function attemptKey(a: Attempt): string {
  // Encoded as a list, so no value can run into its neighbour.
  return JSON.stringify([a.boothId, a.date, a.start, a.end, a.booker]);
}

/** Server messages by attempt key, so the form need not ask twice. */
export type Verdicts = ReadonlyMap<string, string>;

export const NO_VERDICTS: Verdicts = new Map();

/** Copies and adds: a later refusal must not evict an earlier one. */
export function withVerdict(
  verdicts: Verdicts,
  attempt: string,
  message: string,
): Verdicts {
  return new Map(verdicts).set(attempt, message);
}

/** The verdict lapses once any part of the attempt changes. */
export function verdictFor(verdicts: Verdicts, attempt: string): string {
  return verdicts.get(attempt) ?? "";
}

/** The note prompt to show: the form's own ask, else the server's. */
export function noteAsk(
  check: BookingCheck,
  demanded: string,
  note: string,
): string {
  if (check.field === "note") return check.problem;
  return demanded && !note.trim() ? demanded : "";
}

export function isBlocking(check: BookingCheck): boolean {
  // A missing note is about a field not reached yet, not the times chosen.
  return !!check.problem && check.field !== "note";
}

export function noteRequiredMessage(
  partOfRun: boolean,
  autoApproveMaxHours: number,
): string {
  return partOfRun
    ? `Please say what the reservation is for - back to back with your other bookings this comes to ${autoApproveMaxHours} hours or more.`
    : `Please say what the reservation is for - a note is required for ${autoApproveMaxHours} hours or more.`;
}

/** Every route check the browser can make, to pre-empt a server rejection. */
export function checkBooking(input: BookingCheckInput): BookingCheck {
  const {
    startMin,
    endMin,
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
    !isBookableMinute(startMin, stepMinutes) ||
    !isBookableMinute(endMin, stepMinutes)
  )
    return no(offGridMessage(stepMinutes));
  if (endMin <= startMin) return no(END_BEFORE_START_MESSAGE);
  if (!meetsMinDuration(duration, minReservationMinutes))
    return no(tooShortMessage(minReservationMinutes));
  if (startMin < earliestMin) return no(TIME_PASSED_MESSAGE);

  const clash = findOverlap(startMin, endMin, reserved);
  if (clash)
    return no(`That overlaps an existing reservation (${clash.label}).`);
  // The server rejects two booths at once; this browser knows its own.
  if (findOverlap(startMin, endMin, held)) return no(USER_BUSY_MESSAGE);

  if (mustNote && !note.trim())
    return no(noteRequiredMessage(partOfRun, autoApproveMaxHours), "note");
  return no("");
}
