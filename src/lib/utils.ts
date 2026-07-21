import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Zero-pad a number to two digits, e.g. 9 -> "09". */
export const pad2 = (n: number) => String(n).padStart(2, "0");
