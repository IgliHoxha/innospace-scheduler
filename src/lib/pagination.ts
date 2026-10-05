import type { ReservationFilter } from "./types";

// A plain module, so the server imports values, not client proxies.
export const PAGE_SIZE = 25;
export const INITIAL_FILTER: ReservationFilter = "all";

/** Never 0: an empty list is still page 1, so a clamp has a page to land on. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// Compact list of page numbers with ellipses, e.g. 1 ... 4 5 [6] 7 8 ... 20.
export function pageList(page: number, totalPages: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  // Pages each side of the current one; `window` would shadow the global.
  const siblings = 1;
  for (let p = 1; p <= totalPages; p++) {
    if (
      p === 1 ||
      p === totalPages ||
      (p >= page - siblings && p <= page + siblings)
    ) {
      out.push(p);
    } else if (out[out.length - 1] !== "…") {
      out.push("…");
    }
  }
  return out;
}
