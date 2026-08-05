// Helpers for the typed time fields. 24-hour, hours + minutes.
export type TimePickerType = "hours" | "minutes";

/** Clamp (or loop) a typed value into range and pad to two digits. */
export function getValidNumber(
  value: string,
  { max, min = 0, loop = false }: { max: number; min?: number; loop?: boolean },
) {
  let n = parseInt(value, 10);
  if (!isNaN(n)) {
    if (!loop) {
      if (n > max) n = max;
      if (n < min) n = min;
    } else {
      if (n > max) n = min;
      if (n < min) n = max;
    }
    return n.toString().padStart(2, "0");
  }
  return "00";
}

export function getValidHour(value: string) {
  return getValidNumber(value, { max: 23 });
}

export function getValidMinute(value: string) {
  return getValidNumber(value, { max: 59 });
}

function getValidArrowNumber(
  value: string,
  { min, max, step }: { min: number; max: number; step: number },
) {
  const n = parseInt(value, 10);
  if (!isNaN(n))
    return getValidNumber(String(n + step), { min, max, loop: true });
  return "00";
}

export function getValidArrowHour(value: string, step: number) {
  return getValidArrowNumber(value, { min: 0, max: 23, step });
}

export function getValidArrowMinute(value: string, step: number) {
  return getValidArrowNumber(value, { min: 0, max: 59, step });
}

export function setHours(date: Date, value: string) {
  date.setHours(parseInt(getValidHour(value), 10));
  return date;
}

export function setMinutes(date: Date, value: string) {
  date.setMinutes(parseInt(getValidMinute(value), 10));
  return date;
}

export function setDateByType(date: Date, value: string, type: TimePickerType) {
  return type === "minutes" ? setMinutes(date, value) : setHours(date, value);
}

export function getDateByType(date: Date, type: TimePickerType) {
  return type === "minutes"
    ? getValidMinute(String(date.getMinutes()))
    : getValidHour(String(date.getHours()));
}

export function getArrowByType(
  value: string,
  step: number,
  type: TimePickerType,
) {
  return type === "minutes"
    ? getValidArrowMinute(value, step)
    : getValidArrowHour(value, step);
}

export function maxOf(type: TimePickerType): number {
  return type === "minutes" ? 59 : 23;
}

/** Digits after a keystroke: a fresh field is replaced, then the newest two win. */
export function nextDigits(raw: string, caret: number, fresh: boolean): string {
  const digits = raw.replace(/\D/g, "");
  if (!fresh) return digits.slice(-2);
  return digits.slice(Math.max(0, caret - 1), caret) || digits.slice(-1);
}

/** Finished? Two digits always; one when no second could follow. */
export function isCompleteEntry(digits: string, type: TimePickerType): boolean {
  if (digits.length >= 2) return true;
  if (digits.length !== 1) return false;
  return Number(digits) * 10 > maxOf(type);
}
