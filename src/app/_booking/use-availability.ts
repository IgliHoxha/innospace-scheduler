import { useCallback, useEffect, useRef, useState } from "react";
import {
  availabilityQuery,
  edgeMayBeStale,
  lastBoardWrite,
  noteBoardWrite,
} from "@/lib/availability-url";
import { localMinutes } from "@/lib/datetime";
import {
  markMine,
  readMine,
  type BoardSlot,
  type MineEntry,
  type ReservedSlot,
} from "@/lib/mine";

export interface Availability {
  /** The day this board answers for, so no count shows against another date. */
  date: string;
  reserved: ReservedSlot[];
  /** Active reservations per booth; absent on a copy cached before a deploy. */
  counts?: Record<string, number>;
  earliest: string;
  /** This device's clock when the board arrived, so "earliest" can move with it. */
  loadedAtMin: number;
}

export interface LoadOptions {
  /** Skip the edge's 30s copy, which would omit a booking just made. */
  fresh?: boolean;
  /** A refresh of the board on screen, so the pick stays and nothing unmounts. */
  keepPick?: boolean;
}

/** The booth's board for a day, reloaded whenever either changes. */
export function useAvailability(
  boothId: string,
  date: string,
  /** Stable: a new board drops the old pick, so it must not change identity. */
  clearPick: () => void,
) {
  const [avail, setAvail] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [mine, setMine] = useState<MineEntry[]>([]);
  // A request id stops a slow response winning.
  const reqId = useRef(0);

  const load = useCallback(
    async ({ fresh = false, keepPick = false }: LoadOptions = {}) => {
      if (!boothId || !date) return;
      const id = ++reqId.current;
      if (!keepPick) setLoading(true);
      // Another booth's cached board predates the write too, undoing its count.
      const bust = fresh || edgeMayBeStale(Date.now(), lastBoardWrite());
      try {
        const res = await fetch(
          `/api/availability?${availabilityQuery(boothId, date, bust ? Date.now() : undefined)}`,
          // This browser's cache only: the CDN ignores it, hence the fresh URL.
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok: boolean } & Omit<
          Availability,
          "reserved" | "loadedAtMin"
        > & { reserved: BoardSlot[] };
        if (id !== reqId.current) return;
        const owned = readMine();
        setMine(owned);
        setAvail(
          json.ok
            ? {
                ...json,
                reserved: markMine(json.reserved, owned, boothId, date),
                loadedAtMin: localMinutes(Date.now()),
              }
            : null,
        );
        if (!keepPick) clearPick();
      } catch {
        // A dropped connection or a non-JSON reply: no board beats a stale one.
        if (id === reqId.current) setAvail(null);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [boothId, date, clearPick],
  );

  // The newest loader, so a late reply reloads the board now on screen.
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
    load();
  }, [load]);
  const reload = useCallback(
    (options?: LoadOptions) => latest.current(options),
    [],
  );

  // Back from /bookings restores this page as it was, so ask again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) latest.current({ keepPick: true });
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const noteWrite = useCallback(() => noteBoardWrite(), []);

  return { avail, loading, mine, setMine, load, reload, noteWrite };
}
