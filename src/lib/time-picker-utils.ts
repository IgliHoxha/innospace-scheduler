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
