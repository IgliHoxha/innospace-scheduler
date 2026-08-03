"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import TimeRangePicker from "./TimeRangePicker";
import DayTimeline from "./DayTimeline";
import { SiteFooter } from "@/components/SiteFooter";
import { Topbar } from "@/components/Topbar";
import { type Booth } from "@/lib/booths";
import { MAX_EMAIL, MAX_NAME, MAX_NOTE, type Reservation } from "@/lib/types";
import { validateGuest, type GuestField } from "@/lib/guest";
import {
  approvalRequiredFor,
  findOverlap,
  meetsMinDuration,
  noteRequiredFor,
} from "@/lib/reservation-rules";
import { endForStart, suggestedEndMin } from "@/lib/timeline";
import { formatDateLong } from "@/lib/datetime";
import { formatDuration } from "@/lib/schedule";
import { pad2 } from "@/lib/utils";

/** A reservation already taken for the chosen booth+day, as "HH:MM" times. */
interface Reserved {
  start: string;
  end: string;
  label: string;
  /** Who holds it. Null only if the reservation never carried a name. */
  by: string | null;
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

// The length a booking opens on, and the one a moved start re-anchors its end to.
const PREFERRED_MINUTES = 60;

declare global {
  interface Window {
    // Injected by the Cloudflare Turnstile script when the booking widget is on.
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          appearance?: "always" | "execute" | "interaction-only";
          theme?: "light" | "dark" | "auto";
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          "timeout-callback"?: () => void;
          "before-interactive-callback"?: () => void;
          "after-interactive-callback"?: () => void;
        },
      ) => string;
      reset: (widget?: string) => void;
      remove: (widget?: string) => void;
    };
  }
}

export default function ReservationClient({
  booths,
  dates,
  autoApproveMaxHours,
  minReservationMinutes,
  turnstileSiteKey,
}: {
  booths: Booth[];
  dates: DateOption[];
  /** Reservations longer than this need approval; at this length or longer they need a note. */
  autoApproveMaxHours: number;
  /** Shortest allowed reservation, in minutes. */
  minReservationMinutes: number;
  /** Cloudflare widget key. Undefined when Turnstile is switched off. */
  turnstileSiteKey?: string;
}) {
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

  // Who's booking. No account, so these come with every reservation.
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [guestError, setGuestError] = useState<{
    field: GuestField;
    error: string;
  } | null>(null);

  // Turnstile reserves its box whether or not it ever shows anything, so the slot
  // stays collapsed and only opens while Cloudflare says it is being interactive.
  const [turnstileToken, setTurnstileToken] = useState("");
  const [challenging, setChallenging] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!turnstileSiteKey) return;
    let cancelled = false;
    let id: string | null = null;

    // The script is lazy, so poll for it rather than racing its load event.
    const render = () => {
      if (cancelled) return;
      const ts = window.turnstile;
      if (!ts || !turnstileRef.current) {
        window.setTimeout(render, 200);
        return;
      }
      id = ts.render(turnstileRef.current, {
        sitekey: turnstileSiteKey,
        action: "turnstile-spin-v2",
        appearance: "interaction-only",
        theme: "light",
        callback: (token) => {
          setTurnstileToken(token);
          setChallenging(false);
        },
        // A token that errored, expired or timed out is no longer spendable.
        "error-callback": () => setTurnstileToken(""),
        "expired-callback": () => setTurnstileToken(""),
        "timeout-callback": () => setTurnstileToken(""),
        // The only reliable "I am about to show something" signal there is.
        "before-interactive-callback": () => setChallenging(true),
        "after-interactive-callback": () => setChallenging(false),
      });
      widgetIdRef.current = id;
    };
    render();

    return () => {
      cancelled = true;
      try {
        if (id && window.turnstile) window.turnstile.remove(id);
      } catch {
        /* widget already gone */
      }
      widgetIdRef.current = null;
      setTurnstileToken("");
    };
  }, [turnstileSiteKey]);

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

  /** Clear a field's error as soon as it's edited, so it can't linger. */
  const onGuestEdit = (field: GuestField, set: (v: string) => void) => {
    return (value: string) => {
      set(value);
      setError("");
      if (guestError?.field === field) setGuestError(null);
    };
  };

  async function reserve() {
    if (!canReserve) return;

    // Same validator the route handler runs, so the client can't submit
    // something the server would only reject afterwards.
    const guest = validateGuest({ fullName, email });
    if (!guest.ok) {
      setGuestError({ field: guest.field, error: guest.error });
      document.getElementById(guest.field)?.focus();
      return;
    }
    setGuestError(null);

    // Nothing to spend yet. Reveal the widget rather than letting the server
    // refuse a token the visitor was never shown a way to earn.
    if (turnstileSiteKey && !turnstileToken) {
      setChallenging(true);
      setError("Please complete the human check below, then reserve again.");
      return;
    }

    setReservation(true);
    setError("");
    setSuccess(null);
    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boothId,
          date,
          start,
          end,
          note,
          turnstileToken,
          ...guest.guest,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok: boolean;
        error?: string;
        field?: GuestField;
        reservation?: Reservation;
      };
      if (res.ok && json.ok) {
        const booth = booths.find((b) => b.id === boothId)?.name ?? "Booth";
        const when = `${booth} on ${formatDateLong(date)}, ${start} - ${end}`;
        setSuccess(
          json.reservation?.status === "pending"
            ? `Request submitted: ${when}. Reservations over ${autoApproveMaxHours} hours need admin approval - we'll email you once it's reviewed. The slot is held for you meanwhile.`
            : `Reserved ${when}. We've emailed ${guest.guest.email} a confirmation, with a link to cancel if your plans change.`,
        );
        setNote("");
        await loadAvailability();
      } else {
        if (json.field)
          setGuestError({ field: json.field, error: json.error! });
        setError(json.error || "Could not reserve that time.");
        loadAvailability(); // someone may have just taken it
      }
    } finally {
      setReservation(false);
      // A token is single-use, so the widget needs a fresh one either way:
      // without this a second booking (or a retry after an error) is refused.
      if (turnstileSiteKey) {
        setTurnstileToken("");
        window.turnstile?.reset(widgetIdRef.current ?? undefined);
      }
    }
  }

  const selectedBooth = booths.find((b) => b.id === boothId);
  const fieldError = (field: GuestField) =>
    guestError?.field === field ? guestError.error : "";

  return (
    <>
      <Topbar brandHref="/" brandLabel="Innospace Scheduler" />

      <div className="container">
        <h1 className="page-title">Reserve a meeting booth</h1>
        <p className="page-subtitle">
          No account needed. Pick a booth and a time, tell us who you are, and
          we&apos;ll email you the confirmation. Reservations of{" "}
          {autoApproveMaxHours} hours or more need a note saying what the booth
          is for, and anything over {autoApproveMaxHours} hours needs admin
          approval before it&apos;s confirmed (the slot is held for you
          meanwhile).
        </p>

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
            {avail ? `· open ${avail.opens} - ${avail.closes}` : "·"}
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
                ? `We're closed for today (${avail.opens} - ${avail.closes}). Pick another date.`
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
                      // A moved start drags the end an hour after it, so the pair
                      // stays bookable instead of leaving a stale end behind.
                      const reanchored =
                        from === start
                          ? null
                          : endForStart(
                              toMinutes(from),
                              freeGaps,
                              minReservationMinutes,
                              PREFERRED_MINUTES,
                            );
                      setStart(from);
                      setEnd(reanchored == null ? to : toTime(reanchored));
                      setError("");
                    }}
                    defaultRange={{
                      from: toTime(freeGaps[0].from),
                      to: toTime(
                        suggestedEndMin(
                          freeGaps[0].from,
                          freeGaps[0].to,
                          minReservationMinutes,
                          PREFERRED_MINUTES,
                        ) ?? freeGaps[0].to,
                      ),
                    }}
                  />
                </div>

                {duration > 0 && !problem && (
                  <span className="duration-pill">
                    {formatDuration(duration)}
                  </span>
                )}
              </div>

              <DayTimeline
                opens={avail.opens}
                closes={avail.closes}
                earliest={avail.earliest}
                reserved={avail.reserved}
                selection={start && end ? { start, end } : null}
              />
            </>
          )}
        </div>

        {/* Step 4: who's booking */}
        <div className="field-label">Your details</div>
        <div className="card guest-card">
          <div className="guest-row">
            <label className="guest-field">
              <span>Full name</span>
              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                placeholder="First and last name"
                maxLength={MAX_NAME}
                required
                aria-invalid={!!fieldError("fullName")}
                className={fieldError("fullName") ? "invalid" : ""}
                value={fullName}
                onChange={(e) =>
                  onGuestEdit("fullName", setFullName)(e.target.value)
                }
              />
            </label>
            <label className="guest-field">
              <span>Email</span>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={MAX_EMAIL}
                required
                aria-invalid={!!fieldError("email")}
                className={fieldError("email") ? "invalid" : ""}
                value={email}
                onChange={(e) => onGuestEdit("email", setEmail)(e.target.value)}
              />
            </label>
          </div>
          {guestError && <p className="error">{guestError.error}</p>}
        </div>

        {/* Note + submit */}
        <textarea
          id="note"
          name="note"
          aria-label="Note"
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

        {/* Empty until Cloudflare decides to challenge, and collapsed to nothing
            while it stays that way, so an ordinary booking sees no gap here.
            The script is loaded without render=explicit's usual onload hook: the
            effect above polls for it instead. */}
        {turnstileSiteKey && (
          <>
            <Script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
              strategy="afterInteractive"
            />
            <div
              ref={turnstileRef}
              className={`turnstile-slot ${challenging ? "is-challenging" : ""}`}
            />
          </>
        )}

        {problem && <p className="error">{problem}</p>}
        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}

        <div className="reserve-bar">
          <div className="reserve-summary">
            {start && end && !problem ? (
              <>
                <strong>{selectedBooth?.name}</strong> ·{" "}
                {dates.find((d) => d.value === date)?.label} · {start} - {end}
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
      </div>

      <SiteFooter />
    </>
  );
}
