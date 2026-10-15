// Env-free, shared by the form and the route, so both offer the same repeats.
import { formatDateLong, shiftDate } from "./datetime";

// Short enough that one series cannot wall off a booth for a season.
export const MAX_REPEAT_WEEKS = 8;

export const REPEAT_SIGN_IN_MESSAGE =
  "Sign in with Google to set up a weekly repeat.";

export function repeatWeeksMessage(): string {
  return `Choose how many weeks to repeat for, from 1 to ${MAX_REPEAT_WEEKS}.`;
}

/** 1 when absent; null for anything that is not a whole number in range. */
export function parseRepeatWeeks(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return 1;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  if (n < 1 || n > MAX_REPEAT_WEEKS) return null;
  return n;
}

/** The same weekday every week, the given date first. */
export function weeklyDates(date: string, weeks: number): string[] {
  return Array.from({ length: Math.max(1, weeks) }, (_, i) =>
    shiftDate(date, 7 * i),
  );
}

export function repeatLabel(weeks: number): string {
  return weeks > 1 ? `every week for ${weeks} weeks` : "just this once";
}

/** "every week on Thursday, 4 dates": the heading a date list sits under. */
export function seriesHeading(dates: readonly string[]): string {
  const weekday = formatDateLong(dates[0]).split(",")[0];
  return `every week on ${weekday}, ${dates.length} dates`;
}
