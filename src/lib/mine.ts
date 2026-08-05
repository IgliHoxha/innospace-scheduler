// What this browser remembers of its own bookings: a login-less board's only way to say "You".
import { minutesOfDay } from "./datetime";
import { canonicalEmail } from "./guest";

const MINE_KEY = "innospace.mine";

// A convenience, not a record: the server is the truth, so the list stays short.
const MINE_MAX = 50;

/** One remembered booking. Field names are one letter because they go straight into localStorage. */
export interface MineEntry {
  /** slotKey(boothId, startsAt), the identity a board block is matched on. */
  k: string;
  /** startsAt, "YYYY-MM-DDTHH:MM". */
  s: string;
  /** endsAt, same format. */
  e: string;
  /** The email it was booked with, matched canonically. */
  m: string;
  /** The signed token that can cancel it, same one the email carries. */
  t: string;
}

export const slotKey = (boothId: string, startsAt: string) =>
  `${boothId}|${startsAt}`;

/** Every booking this browser recalls, tolerating whatever shape an older version left behind. */
export function readMine(): MineEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    // Entries were bare keys before the run rule needed times; those still label "You".
    return raw.flatMap((x) => {
      if (typeof x === "string") return [{ k: x, s: "", e: "", m: "", t: "" }];
      const e = x as Partial<MineEntry>;
      return e && typeof e.k === "string"
        ? [{ k: e.k, s: e.s ?? "", e: e.e ?? "", m: e.m ?? "", t: e.t ?? "" }]
        : [];
    });
  } catch {
    return []; // private mode, or somebody else's data in the key
  }
}

/** Record a booking, newest first and deduped by slot; returns the new list so state can follow. */
export function rememberMine(entry: MineEntry): MineEntry[] {
  const next = [entry, ...readMine().filter((m) => m.k !== entry.k)].slice(
    0,
    MINE_MAX,
  );
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the board just won't say "You" */
  }
  return next;
}

/** Minutes-since-midnight range of one held booking. */
export interface HeldRange {
  start: number;
  end: number;
}

/** This booker's bookings the board still shows, so the run rule can warn early. */
export function heldRangesFor(opts: {
  entries: readonly MineEntry[];
  /** Already canonicalised; empty until the form knows who is booking. */
  booker: string;
  boothId: string;
  date: string;
  /** "HH:MM" starts the board currently shows for this booth and day. */
  boardStarts: readonly string[];
}): HeldRange[] {
  const { entries, booker, boothId, date, boardStarts } = opts;
  if (!booker) return [];
  const onBoard = new Set(
    boardStarts.map((t) => slotKey(boothId, `${date}T${t}`)),
  );
  return (
    entries
      .filter(
        (m) =>
          m.e && m.s.startsWith(`${date}T`) && canonicalEmail(m.m) === booker,
      )
      // Only what this board still shows: storage outlives the booking it names.
      .filter((m) => onBoard.has(m.k))
      .map((m) => ({ start: minutesOfDay(m.s), end: minutesOfDay(m.e) }))
  );
}
