// Time rules; a reservation carries no TZ, so TZ must match the space.
import { isBookableMinute } from "./reservation-rules";
import { requireIntEnv } from "./env-app";
import { shiftDate, todayYMD } from "./datetime";

/** How many days ahead, including today, can be reserved. */
function reservationWindowDays(): number {
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

export function ceilToStep(minutes: number): number {
  const step = stepMinutes();
  return Math.ceil(minutes / step) * step;
}

export function isValidTimeOfDay(minutes: number): boolean {
  return isBookableMinute(minutes, stepMinutes());
}

export function reservableDates(): string[] {
  const today = todayYMD();
  return Array.from({ length: reservationWindowDays() + 1 }, (_, i) =>
    shiftDate(today, i),
  );
}

export function isReservableDate(date: string | undefined): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return reservableDates().includes(date);
}
