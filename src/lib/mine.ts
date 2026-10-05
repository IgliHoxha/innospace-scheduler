// The board has no login, so "You" is what this browser remembers booking.
import { minutesOfDay } from "./datetime";
import { canonicalEmail } from "./guest";

const MINE_KEY = "innospace.mine";

// A convenience, not a record: the server is the truth, so keep it short.
const MINE_MAX = 50;

/** One remembered booking; one-letter fields go straight into localStorage. */
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

/** A taken slot as the availability route sends it, times as "HH:MM". */
export interface BoardSlot {
  start: string;
  end: string;
  label: string;
}

/** A board slot once this browser has said whether it made the booking. */
export interface ReservedSlot extends BoardSlot {
  /** Booked from this browser; the board never learns who anyone else is. */
  mine: boolean;
  /** The proof needed to cancel; only on a booking this browser made. */
  cancelToken?: string;
}

/** Marks the board's blocks that this browser remembers booking. */
export function markMine(
  reserved: readonly BoardSlot[],
  owned: readonly MineEntry[],
  boothId: string,
  date: string,
): ReservedSlot[] {
  return reserved.map((b) => {
    const held = owned.find(
      (m) => m.k === slotKey(boothId, `${date}T${b.start}`),
    );
    return { ...b, mine: !!held, cancelToken: held?.t || undefined };
  });
}

export function readMine(): MineEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    // Bare keys predate the run rule needing times, and still label "You".
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

/** This booker's bookings still on the board, so the run rule warns early. */
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
      // Storage outlives the booking it names, so trust only the board.
      .filter((m) => onBoard.has(m.k))
      .map((m) => ({ start: minutesOfDay(m.s), end: minutesOfDay(m.e) }))
  );
}
