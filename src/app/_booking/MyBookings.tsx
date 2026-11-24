"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TimePickerInput } from "@/components/ui/time-picker-input";
import {
  dateOf,
  formatDateLong,
  formatDateTime,
  minutesOfDay,
  minutesToTime,
  rangeLabel,
  timeOf,
  timeOfDate,
  timeToMinutes,
} from "@/lib/datetime";
import {
  canCancel,
  canChangeEnd,
  earliestEndMin,
  type BookingPhase,
  type MyBooking,
} from "@/lib/my-bookings";
import { dayEndMinute, offGridMessage } from "@/lib/reservation-rules";

interface Board {
  now: string;
  stepMinutes: number;
  minMinutes: number;
  bookings: MyBooking[];
}

/** Sends one change; resolves to the refusal to show, or "" once it went through. */
type Send = (id: string, init: RequestInit) => Promise<string>;

// Under way first: it is the one with something to decide right now.
const GROUPS: { phase: BookingPhase; title: string }[] = [
  { phase: "ongoing", title: "In progress" },
  { phase: "upcoming", title: "Upcoming" },
  { phase: "past", title: "Past" },
];

const FAILED = "Something went wrong. Please try again.";
const OFFLINE = "Could not reach the server. Please try again.";

function toDate(hhmm: string): Date {
  const d = new Date(2000, 0, 1);
  d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)), 0, 0);
  return d;
}

function StatusBadge({ booking }: { booking: MyBooking }) {
  if (booking.status === "pending")
    return <span className="badge pending">Awaiting approval</span>;
  if (booking.status === "cancelled")
    return <span className="badge cancelled">Cancelled</span>;
  return null;
}

function CancelAction({ booking, send }: { booking: MyBooking; send: Send }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cancel = async () => {
    setBusy(true);
    setError(await send(booking.id, { method: "DELETE" }));
    setBusy(false);
    setAsking(false);
  };

  return (
    <div className="my-booking-actions">
      {asking ? (
        <>
          <span className="my-booking-ask">Cancel this booking?</span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setAsking(false)}
            disabled={busy}
          >
            Keep it
          </button>
          <button
            type="button"
            className="btn danger sm"
            onClick={cancel}
            disabled={busy}
          >
            {busy ? "Cancelling…" : "Yes, cancel"}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setAsking(true)}
        >
          Cancel
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function EndEditor({
  booking,
  board,
  send,
}: {
  booking: MyBooking;
  board: Board;
  send: Send;
}) {
  const current = timeOf(booking.endsAt);
  const [end, setEnd] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const minutesRef = useRef<HTMLInputElement>(null);
  const hoursRef = useRef<HTMLInputElement>(null);

  const step = board.stepMinutes;
  const earliest = earliestEndMin(
    minutesOfDay(booking.startsAt),
    minutesOfDay(board.now),
    step,
    board.minMinutes,
  );
  const latest = dayEndMinute(step);
  const endMin = timeToMinutes(end);
  // The server judges clashes and limits; these are the ones the dialog can see.
  const problem =
    endMin % step !== 0
      ? offGridMessage(step)
      : endMin < earliest
        ? `Pick ${minutesToTime(earliest)} or later.`
        : endMin > latest
          ? `Pick ${minutesToTime(latest)} or earlier.`
          : "";

  const pick = (d: Date) => {
    setEnd(timeOfDate(d));
    setError("");
  };

  const save = async () => {
    setBusy(true);
    setError(
      await send(booking.id, {
        method: "PATCH",
        body: JSON.stringify({ end }),
      }),
    );
    setBusy(false);
  };

  const fieldId = `end-${booking.id}`;
  return (
    <div className="my-booking-actions">
      <span className="my-booking-ask">Ends at</span>
      <div className="tp-inputs">
        <TimePickerInput
          picker="hours"
          id={`${fieldId}-hours`}
          name={`${fieldId}-hours`}
          aria-label="New end hour"
          date={toDate(end)}
          setDate={pick}
          ref={hoursRef}
          onRightFocus={() => minutesRef.current?.focus()}
        />
        <span className="tp-colon">:</span>
        <TimePickerInput
          picker="minutes"
          id={`${fieldId}-minutes`}
          name={`${fieldId}-minutes`}
          aria-label="New end minute"
          date={toDate(end)}
          setDate={pick}
          ref={minutesRef}
          onLeftFocus={() => hoursRef.current?.focus()}
        />
      </div>
      <button
        type="button"
        className="btn sm"
        onClick={save}
        disabled={busy || end === current || !!problem}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {(error || (end !== current && problem)) && (
        <p className="error" role="alert">
          {error || problem}
        </p>
      )}
    </div>
  );
}

function BookingRow({
  booking,
  board,
  send,
}: {
  booking: MyBooking;
  board: Board;
  send: Send;
}) {
  return (
    <li className={`my-booking ${booking.phase}`}>
      <div className="my-booking-head">
        <strong>{booking.boothName}</strong>
        <StatusBadge booking={booking} />
      </div>
      <dl className="my-booking-facts">
        <dt>Date</dt>
        <dd>{formatDateLong(dateOf(booking.startsAt))}</dd>
        <dt>Time</dt>
        <dd>{rangeLabel(booking.startsAt, booking.endsAt)}</dd>
        <dt>Booked on</dt>
        <dd>{formatDateTime(booking.createdAt)}</dd>
        {booking.note && (
          <>
            <dt>Note</dt>
            <dd className="my-booking-note">{booking.note}</dd>
          </>
        )}
      </dl>
      {canCancel(booking) && <CancelAction booking={booking} send={send} />}
      {canChangeEnd(booking) && (
        // Keyed on the end, so a saved change reseeds the fields.
        <EndEditor
          key={booking.endsAt}
          booking={booking}
          board={board}
          send={send}
        />
      )}
    </li>
  );
}

/** A signed-in member's own bookings: cancel what is ahead, move the end of what is under way, read the rest. */
export function MyBookings({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  /** A cancel or a new end frees or takes time on the board behind. */
  onChanged: () => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/me/reservations", { cache: "no-store" });
      const json = (await res.json()) as Board & { ok?: boolean };
      if (!res.ok || !json.ok) throw new Error("refused");
      setBoard(json);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Through a ref, or every parent render would rerun this and steal focus.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const send: Send = async (id, init) => {
    try {
      const res = await fetch(
        `/api/me/reservations/${encodeURIComponent(id)}`,
        { ...init, headers: { "Content-Type": "application/json" } },
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) return json.error || FAILED;
      onChanged();
      await load();
      return "";
    } catch {
      return OFFLINE;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal my-bookings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="my-bookings-title"
      >
        <button
          type="button"
          className="modal-close"
          aria-label="Close"
          onClick={onClose}
          ref={closeRef}
        >
          ×
        </button>
        <h2 id="my-bookings-title">My bookings</h2>

        {failed ? (
          <div className="load-failed">
            <span className="muted">Couldn&apos;t load your bookings.</span>
            <button type="button" className="btn ghost sm" onClick={load}>
              Try again
            </button>
          </div>
        ) : !board ? (
          <p className="muted">Loading your bookings…</p>
        ) : board.bookings.length === 0 ? (
          <p className="muted">You have no bookings yet.</p>
        ) : (
          GROUPS.map(({ phase, title }) => {
            const rows = board.bookings.filter((b) => b.phase === phase);
            if (rows.length === 0) return null;
            return (
              <section key={phase} className="my-bookings-group">
                <h3>{title}</h3>
                <ul>
                  {rows.map((b) => (
                    <BookingRow
                      key={b.id}
                      booking={b}
                      board={board}
                      send={send}
                    />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
