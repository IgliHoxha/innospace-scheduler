import type { ReservationStatus } from "./types";

// A plain module, so the server imports values, not client proxies.
export const PAGE_SIZE = 25;
export const INITIAL_FILTER: "all" | ReservationStatus = "all";
