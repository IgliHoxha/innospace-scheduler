// Time rules; a reservation carries no TZ, so TZ must match the space.
import {
  approvalRequiredFor,
  isBookableMinute,
  noteRequiredFor,
} from "./reservation-rules";
import { requireIntEnv } from "./env-app";
import { timeOf, durationMinutes, ymd } from "./datetime";

/** How many days ahead, including today, can be reserved. */
export function reservationWindowDays(): number {
  return Math.max(0, requireIntEnv("RESERVATION_WINDOW_DAYS"));
}

export function stepMinutes(): number {
  const v = requireIntEnv("TIME_STEP_MINUTES");
  if (!(v > 0 && v <= 60 && 60 % v === 0)) {
    throw new Error(
      "TIME_STEP_MINUTES must divide 60 evenly (1/5/10/15/30/60).",
    );
  }
  return v;
}

export function minReservationMinutes(): number {
  return Math.max(stepMinutes(), requireIntEnv("MIN_RESERVATION_MINUTES"));
}

export function autoApproveMaxHours(): number {
  return Math.max(1, requireIntEnv("AUTO_APPROVE_MAX_HOURS"));
}

export function needsApproval(startsAt: string, endsAt: string): boolean {
  return approvalRequiredFor(
    durationMinutes(startsAt, endsAt),
    autoApproveMaxHours(),
  );
}

/** One step wider than approval: `>=` needs a note, `>` needs approval. */
export function noteRequired(startsAt: string, endsAt: string): boolean {
  return noteRequiredFor(
    durationMinutes(startsAt, endsAt),
    autoApproveMaxHours(),
  );
}

export function ceilToStep(minutes: number): number {
  const step = stepMinutes();
  return Math.ceil(minutes / step) * step;
}

export function isValidTimeOfDay(minutes: number): boolean {
  return isBookableMinute(minutes, stepMinutes());
}

export function rangeLabel(startsAt: string, endsAt: string): string {
  return `${timeOf(startsAt)} - ${timeOf(endsAt)}`;
}

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function reservationCountLabel(count: number): string {
  const n = Math.max(0, count);
  return n === 1 ? "1 reservation" : `${n} reservations`;
}

export function durationLabel(startsAt: string, endsAt: string): string {
  return formatDuration(durationMinutes(startsAt, endsAt));
}

export function reservableDates(): string[] {
  const out: string[] = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0); // noon avoids a DST off-by-one when adding days
  for (let i = 0; i <= reservationWindowDays(); i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push(ymd(d));
  }
  return out;
}

export function isReservableDate(date: string | undefined): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return reservableDates().includes(date);
}
