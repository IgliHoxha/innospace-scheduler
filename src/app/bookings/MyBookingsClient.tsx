"use client";

import { useRef, useState } from "react";
import { Pagination } from "@/components/Pagination";
import { SiteFooter } from "@/components/SiteFooter";
import { Topbar } from "@/components/Topbar";
import { TimePickerInput } from "@/components/ui/time-picker-input";
import { noteBoardWrite } from "@/lib/availability-url";
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
  type MyBookingsPage,
} from "@/lib/my-bookings";
import { pageCount } from "@/lib/pagination";
import { dayEndMinute, offGridMessage } from "@/lib/reservation-rules";

type Board = MyBookingsPage;

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
      <div className="tp-scope tp-inputs my-booking-end">
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
      {canChangeEnd(booking) && (
        // Keyed on the end, so a saved change reseeds the fields.
        <EndEditor
          key={booking.endsAt}
          booking={booking}
          board={board}
          send={send}
        />
      )}
      {/* After the end editor, so a booking under way reads: move the end, or drop it. */}
      {canCancel(booking) && <CancelAction booking={booking} send={send} />}
    </li>
  );
}

/** A signed-in member's own bookings: cancel what is ahead, move the end of what is under way, read the rest. */
export default function MyBookingsClient({
  name,
  email,
  initial,
}: {
  name: string;
  email: string;
  /** Page the server already rendered, so the list shows without a round trip. */
  initial: MyBookingsPage;
}) {
  const [board, setBoard] = useState<Board>(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = async (page: number): Promise<boolean> => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/me/reservations?page=${page}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as Board & { ok?: boolean };
      if (!res.ok || !json.ok) throw new Error("refused");
      setBoard(json);
      // In the address bar, so a reload or a shared link opens on the same page.
      window.history.replaceState(
        null,
        "",
        json.page > 1 ? `/bookings?page=${json.page}` : "/bookings",
      );
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const turnTo = async (page: number) => {
    if (await load(page)) listRef.current?.scrollIntoView?.({ block: "start" });
  };

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
      // A cancel or a new end changes the board "/" shows next.
      noteBoardWrite();
      await load(board.page);
      return "";
    } catch {
      return OFFLINE;
    }
  };

  return (
    <>
      <Topbar
        brandHref="/"
        brandLabel="Innospace Scheduler"
        username={name}
        email={email}
        signOutTo="/"
        myBookingsHref="/bookings"
      />

      <div className="container" ref={listRef}>
        <div className="page-head">
          <a className="back-link" href="/">
            ‹ Reserve a booth
          </a>
          <h1 className="page-title">My bookings</h1>
          <p className="page-subtitle">
            Cancel a booking that isn&apos;t over yet, change the end time of
            one that&apos;s under way, and look back at the ones that are over.
          </p>
        </div>

        {failed && (
          <div className="load-failed">
            <span className="muted">Couldn&apos;t load your bookings.</span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => load(board.page)}
            >
              Try again
            </button>
          </div>
        )}

        {board.total === 0 ? (
          <div className="card empty">
            You have no bookings yet. <a href="/">Reserve a booth</a>
          </div>
        ) : (
          <div className="my-bookings" aria-busy={loading}>
            {GROUPS.map(({ phase, title }) => {
              const rows = board.bookings.filter((b) => b.phase === phase);
              if (rows.length === 0) return null;
              return (
                <section key={phase} className="my-bookings-group">
                  <h2>{title}</h2>
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
            })}
            <Pagination
              page={board.page}
              totalPages={pageCount(board.total, board.pageSize)}
              total={board.total}
              pageSize={board.pageSize}
              shown={board.bookings.length}
              loading={loading}
              onPage={turnTo}
            />
          </div>
        )}
      </div>

      <SiteFooter />
    </>
  );
}
