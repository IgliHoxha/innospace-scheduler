import { useCallback, useEffect, useRef, useState } from "react";
import { availabilityQuery, edgeMayBeStale } from "@/lib/availability-url";
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
  // When this browser last wrote, so later loads skip the edge's older copy.
  const wroteAt = useRef(0);
  // A request id stops a slow response winning.
  const reqId = useRef(0);

  const load = useCallback(
    async ({ fresh = false, keepPick = false }: LoadOptions = {}) => {
      if (!boothId || !date) return;
      const id = ++reqId.current;
      if (!keepPick) setLoading(true);
      // Another booth's cached board predates the write too, undoing its count.
      const bust = fresh || edgeMayBeStale(Date.now(), wroteAt.current);
      try {
        const res = await fetch(
          `/api/availability?${availabilityQuery(boothId, date, bust ? Date.now() : undefined)}`,
          // This browser's cache only: the CDN ignores it, hence the fresh URL.
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok: boolean } & Omit<
          Availability,
          "reserved"
        > & { reserved: BoardSlot[] };
        if (id !== reqId.current) return;
        const owned = readMine();
        setMine(owned);
        setAvail(
          json.ok
            ? {
                ...json,
                reserved: markMine(json.reserved, owned, boothId, date),
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

  // The newest loader, so a reply landing after a booth or date change reloads the board on screen.
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
    load();
  }, [load]);
  const reload = useCallback(
    (options?: LoadOptions) => latest.current(options),
    [],
  );

  const noteWrite = useCallback(() => {
    wroteAt.current = Date.now();
  }, []);

  return { avail, loading, mine, setMine, load, reload, noteWrite };
}
