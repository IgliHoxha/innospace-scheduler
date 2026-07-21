"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TimeRangePicker from "./TimeRangePicker";
import { SiteFooter } from "@/components/SiteFooter";
import type { Booth } from "@/lib/booths";
import type { Reservation } from "@/lib/types";
import { MAX_NOTE } from "@/lib/types";
import {
  approvalRequiredFor,
  findOverlap,
  meetsMinDuration,
  noteRequiredFor,
} from "@/lib/reservation-rules";
import { boothLabel, timeText, dateOfReservation } from "@/lib/templates";
import { formatDateLong, formatDateMedium } from "@/lib/date-format";
import { formatDuration } from "@/lib/schedule";
import { pad2 } from "@/lib/utils";

/** A reservation already taken for the chosen booth+day, as "HH:MM" times. */
interface Reserved {
  start: string;
  end: string;
  label: string;
  /** Who holds it. Null only if the reservation never carried a name. */
  by: string | null;
  mine: boolean;
}

interface Availability {
  reserved: Reserved[];
  earliest: string;
  opens: string;
  closes: string;
}

interface DateOption {
  value: string;
  label: string;
}

const toMinutes = (t: string) =>
  Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const toTime = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

export default function ReservationClient({
  booths,
  dates,
  userName,
  initialMine,
  autoApproveMaxHours,
  minReservationMinutes,
}: {
  booths: Booth[];
  dates: DateOption[];
  userName: string;
  initialMine: Reservation[];
  /** Reservations longer than this need approval; at this length or longer they need a note. */
  autoApproveMaxHours: number;
  /** Shortest allowed reservation, in minutes. */
  minReservationMinutes: number;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const [boothId, setBoothId] = useState(booths[0]?.id ?? "");
  const [date, setDate] = useState(dates[0]?.value ?? "");
  const [avail, setAvail] = useState<Availability | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [reservation, setReservation] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  const [mine, setMine] = useState<Reservation[]>(initialMine);
  const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null);

  // Reload what's taken whenever booth or date changes. A request id guards
  // against a slow response overwriting a newer selection.
  const reqId = useRef(0);
  const loadAvailability = useCallback(async () => {
    if (!boothId || !date) return;
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/availability?booth=${encodeURIComponent(boothId)}&date=${encodeURIComponent(date)}`,
      );
      const json = (await res.json()) as { ok: boolean } & Availability;
      if (id !== reqId.current) return;
      setAvail(json.ok ? json : null);
      setStart("");
      setEnd("");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [boothId, date]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  async function refreshMine() {
    const res = await fetch("/api/reservations?pageSize=100");
    const json = (await res.json()) as {
      ok: boolean;
      reservations?: Reservation[];
    };
    if (json.ok && json.reservations) setMine(json.reservations);
  }

  const startMin = start ? toMinutes(start) : null;
  const endMin = end ? toMinutes(end) : null;
  const duration = startMin != null && endMin != null ? endMin - startMin : 0;
  const mustNote = noteRequiredFor(duration, autoApproveMaxHours);
  const willNeedApproval = approvalRequiredFor(duration, autoApproveMaxHours);

  // Reservable free stretches. If none (day over or fully taken) we hide the picker
  // and say why instead.
  const freeGaps = useMemo(() => {
    if (!avail) return [];
    const dayEnd = toMinutes(avail.closes);
    const busy = avail.reserved
      .map((b) => ({ from: toMinutes(b.start), to: toMinutes(b.end) }))
      .sort((a, b) => a.from - b.from);
    let cursor = Math.max(toMinutes(avail.opens), toMinutes(avail.earliest));
    const gaps: { from: number; to: number }[] = [];
    for (const b of busy) {
      if (b.from > cursor)
        gaps.push({ from: cursor, to: Math.min(b.from, dayEnd) });
      cursor = Math.max(cursor, b.to);
    }
    if (cursor < dayEnd) gaps.push({ from: cursor, to: dayEnd });
    return gaps.filter((g) => g.to - g.from >= minReservationMinutes);
  }, [avail, minReservationMinutes]);

  const noTimeLeft = !!avail && freeGaps.length === 0;
  const dayIsOver =
    !!avail && toMinutes(avail.earliest) >= toMinutes(avail.closes);

  function validate(): string {
    if (!avail || !start || !end || startMin == null || endMin == null)
      return "";
    if (endMin <= startMin) return "The end time must be after the start time.";
    if (!meetsMinDuration(duration, minReservationMinutes))
      return `Reservations must be at least ${minReservationMinutes} minutes long.`;
    const clash = findOverlap(
      startMin,
      endMin,
      avail.reserved.map((b) => ({
        start: toMinutes(b.start),
        end: toMinutes(b.end),
        label: b.label,
      })),
    );
    if (clash) return `That overlaps an existing reservation (${clash.label}).`;
    if (mustNote && !note.trim())
      return `Please say what the reservation is for - a note is required for ${autoApproveMaxHours} hours or more.`;
    return "";
  }

  const problem = validate();
  const canReserve = !!start && !!end && !problem && !reservation;

  async function reserve() {
    if (!canReserve) return;
    setReservation(true);
    setError("");
    setSuccess(null);
    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boothId, date, start, end, note }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok: boolean;
        error?: string;
        reservation?: Reservation;
      };
      if (res.ok && json.ok) {
        const booth = booths.find((b) => b.id === boothId)?.name ?? "Booth";
        const when = `${booth} on ${formatDateLong(date)}, ${start} – ${end}`;
        setSuccess(
          json.reservation?.status === "pending"
            ? `Request submitted: ${when}. Reservations over ${autoApproveMaxHours} hours need admin approval - we'll email you once it's reviewed. The slot is held for you meanwhile.`
            : `Reserved ${when}.`,
        );
        setNote("");
        await Promise.all([loadAvailability(), refreshMine()]);
      } else {
        setError(json.error || "Could not reserve that time.");
        loadAvailability(); // someone may have just taken it
      }
    } finally {
      setReservation(false);
    }
  }

  async function cancel(r: Reservation) {
    setCancelTarget(null);
    await fetch(`/api/reservations/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    await Promise.all([refreshMine(), loadAvailability()]);
  }

  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
  }

  // Close the user menu on any outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const upcoming = mine.filter((r) => r.status !== "deleted");
  const selectedBooth = booths.find((b) => b.id === boothId);

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="Innospace Scheduler">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="topbar-logo"
              src="/logo.svg"
              alt="Innospace Tirana"
            />
            <span className="brand-sub">Scheduler</span>
          </a>
          <div className="user-menu">
            <button
              className="user-btn"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="avatar">{userName.charAt(0).toUpperCase()}</span>
              <span className="user-name">{userName}</span>
              <span className="caret">▾</span>
            </button>
            {menuOpen && (
              <div className="user-dropdown" role="menu">
                <div className="user-dropdown-head">
                  Signed in as
                  <strong>{userName}</strong>
                </div>
                <button className="user-dropdown-item" onClick={logout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="container">
        <h1 className="page-title">Reserve a meeting booth</h1>

        {/* Step 1: booth */}
        <div className="field-label">Booth</div>
        <div className="booth-grid">
          {booths.map((b) => (
            <button
              key={b.id}
              className={`booth-card ${b.id === boothId ? "active" : ""}`}
              onClick={() => setBoothId(b.id)}
            >
              <span className="booth-name">{b.name}</span>
              {b.capacity ? (
                <span className="booth-cap">{b.capacity} seats</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Step 2: date */}
        <div className="field-label">Date</div>
        <div className="date-row">
          {dates.map((d) => (
            <button
              key={d.value}
              className={`chip ${d.value === date ? "active" : ""}`}
              onClick={() => setDate(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Step 3: time range */}
        <div className="field-label">
          Time{" "}
          <span className="hint">
            {avail ? `· open ${avail.opens} – ${avail.closes}` : "·"}
          </span>
        </div>
        <div className="card time-card">
          {loading ? (
            <span className="muted">Loading availability…</span>
          ) : !avail ? (
            <span className="muted">Couldn&apos;t load availability.</span>
          ) : noTimeLeft ? (
            <div className="empty">
              {dayIsOver
                ? `We're closed for today (${avail.opens} – ${avail.closes}). Pick another date.`
                : "This booth is fully reserved on this day. Try another booth or date."}
            </div>
          ) : (
            <>
              <div className="time-row">
                <div className="time-field">
                  <span>Start &amp; end</span>
                  <TimeRangePicker
                    value={start && end ? { from: start, to: end } : null}
                    onChange={({ from, to }) => {
                      setStart(from);
                      setEnd(to);
                      setError("");
                    }}
                    initial={toTime(freeGaps[0].from)}
                  />
                </div>

                {duration > 0 && !problem && (
                  <span className="duration-pill">
                    {formatDuration(duration)}
                  </span>
                )}
              </div>

              <div className="reserved-list">
                {avail.reserved.length === 0 ? (
                  <span className="muted">
                    Nothing reserved yet - the whole day is free.
                  </span>
                ) : (
                  <>
                    <span className="muted">Already reserved:</span>
                    {avail.reserved.map((b) => (
                      <span key={b.start} className="reserved-chip">
                        {b.label}
                        {(b.mine || b.by) && (
                          <span className="reserved-by">
                            {b.mine ? "You" : b.by}
                          </span>
                        )}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Note + submit */}
        <textarea
          className={`note-box ${mustNote && !note.trim() ? "required" : ""}`}
          placeholder={
            mustNote
              ? `Note (required for ${autoApproveMaxHours} hours or more) - what is the booth for?`
              : "Note (optional) - e.g. what the booth is for"
          }
          rows={2}
          maxLength={MAX_NOTE}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError("");
          }}
          aria-required={mustNote}
        />

        {problem && <p className="error">{problem}</p>}
        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}

        <div className="reserve-bar">
          <div className="reserve-summary">
            {start && end && !problem ? (
              <>
                <strong>{selectedBooth?.name}</strong> ·{" "}
                {dates.find((d) => d.value === date)?.label} · {start} – {end}
                {willNeedApproval && (
                  <span className="hint"> · needs admin approval</span>
                )}
              </>
            ) : (
              <span className="muted">
                Pick a start and end time to reserve.
              </span>
            )}
          </div>
          <button className="btn" disabled={!canReserve} onClick={reserve}>
            {reservation ? "Reservation…" : "Reserve"}
          </button>
        </div>

        {/* My reservations */}
        <h2 className="section-title">My reservations</h2>
        <div className="card">
          {upcoming.length === 0 ? (
            <div className="empty">You have no reservations yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Booth</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((r) => (
                  <tr key={r.id}>
                    <td>{boothLabel(r)}</td>
                    <td className="dates">
                      {formatDateMedium(dateOfReservation(r))}
                    </td>
                    <td className="dates">{timeText(r)}</td>
                    <td>
                      <span className={`badge ${r.status}`}>{r.status}</span>
                    </td>
                    <td>
                      {(r.status === "confirmed" || r.status === "pending") && (
                        <button
                          className="btn ghost sm"
                          onClick={() => setCancelTarget(r)}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {cancelTarget && (
        <div
          className="modal-overlay"
          onClick={() => setCancelTarget(null)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2>Cancel reservation?</h2>
            <p>
              Cancel <strong>{boothLabel(cancelTarget)}</strong> on{" "}
              {formatDateLong(dateOfReservation(cancelTarget))} (
              {timeText(cancelTarget)})? The slot will be freed for others.
            </p>
            <div className="modal-actions">
              <button
                className="btn ghost"
                onClick={() => setCancelTarget(null)}
              >
                Keep it
              </button>
              <button
                className="btn danger"
                onClick={() => cancel(cancelTarget)}
              >
                Yes, cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <SiteFooter />
    </>
  );
}
