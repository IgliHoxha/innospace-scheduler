"use client";

import { useRef, useState } from "react";
import { Pagination } from "@/components/Pagination";
import { SiteFooter } from "@/components/SiteFooter";
import { Topbar } from "@/components/Topbar";
import { noteBoardWrite } from "@/lib/availability-url";
import {
  dateOf,
  formatDateLong,
  formatDateTime,
  rangeLabel,
} from "@/lib/datetime";
import {
  canCancel,
  canEndNow,
  type BookingPhase,
  type MyBooking,
  type MyBookingsPage,
} from "@/lib/my-bookings";
import { pageCount } from "@/lib/pagination";

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

function StatusBadge({ booking }: { booking: MyBooking }) {
  if (booking.status === "pending")
    return <span className="badge pending">Awaiting approval</span>;
  if (booking.status === "cancelled")
    return <span className="badge cancelled">Cancelled</span>;
  return null;
}

/** One thing a member can do to a booking, asked about before it is sent. */
interface RowAction {
  label: string;
  question: string;
  yes: string;
  busy: string;
  method: "PATCH" | "DELETE";
  /** The plain button's look; the confirming one is always the danger button. */
  look: string;
}

// No end time is sent: the server's clock decides when "now" is.
const END_NOW: RowAction = {
  label: "Terminate now",
  question: "End this booking now?",
  yes: "Yes, terminate",
  busy: "Terminating…",
  method: "PATCH",
  look: "btn sm",
};

const CANCEL: RowAction = {
  label: "Cancel",
  question: "Cancel this booking?",
  yes: "Yes, cancel",
  busy: "Cancelling…",
  method: "DELETE",
  look: "btn ghost sm",
};

function RowActions({ booking, send }: { booking: MyBooking; send: Send }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // One or the other: a booking that has started is ended, never cancelled, from here.
  const action = canEndNow(booking)
    ? END_NOW
    : canCancel(booking)
      ? CANCEL
      : null;
  if (!action) return null;

  const confirm = async () => {
    setBusy(true);
    setError(await send(booking.id, { method: action.method }));
    setBusy(false);
    setAsking(false);
  };

  return (
    <div className="my-booking-actions">
      {asking ? (
        <>
          <span className="my-booking-ask">{action.question}</span>
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
            onClick={confirm}
            disabled={busy}
          >
            {busy ? action.busy : action.yes}
          </button>
        </>
      ) : (
        <button
          type="button"
          className={action.look}
          onClick={() => {
            setError("");
            setAsking(true);
          }}
        >
          {action.label}
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

function BookingRow({ booking, send }: { booking: MyBooking; send: Send }) {
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
      <RowActions booking={booking} send={send} />
    </li>
  );
}

/** A signed-in member's own bookings: cancel what is ahead, end what is under way, read the rest. */
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
      // A cancel or an early end changes the board "/" shows next.
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
            Cancel a booking that hasn&apos;t started, end one that&apos;s under
            way right now, and look back at the ones that are over.
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
                      <BookingRow key={b.id} booking={b} send={send} />
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
