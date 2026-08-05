"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import TimeRangePicker from "./TimeRangePicker";
import DayTimeline from "./DayTimeline";
import { SiteFooter } from "@/components/SiteFooter";
import { Topbar } from "@/components/Topbar";
import { type Booth } from "@/lib/booths";
import { MAX_EMAIL, MAX_NAME, MAX_NOTE, type Reservation } from "@/lib/types";
import {
  canonicalEmail,
  isValidEmail,
  validateGuest,
  type GuestField,
} from "@/lib/guest";
import { checkBooking, isBlocking } from "@/lib/booking-check";
import { availabilityQuery } from "@/lib/availability-url";
import {
  heldRangesFor,
  readMine,
  rememberMine,
  slotKey,
  type MineEntry,
} from "@/lib/mine";
import { endForStart, suggestedEndMin } from "@/lib/timeline";
import { formatDateLong, minutesToTime, timeToMinutes } from "@/lib/datetime";
import { formatDuration } from "@/lib/schedule";

/** A reservation already taken for the chosen booth+day, as "HH:MM" times. */
interface Reserved {
  start: string;
  end: string;
  label: string;
  /** Booked from this browser: a login-less screen's only way to know it's yours. */
  mine: boolean;
  /** Present only for a booking this browser made: the proof needed to cancel it. */
  cancelToken?: string;
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

// The length a booking opens on, and the one a moved start re-anchors its end to.
const PREFERRED_MINUTES = 60;

// How long a confirmation stays up; the email repeats it, so nothing is lost.
const SUCCESS_MS = 5000;

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
  stepMinutes,
  contact,
  turnstileSiteKey,
}: {
  booths: Booth[];
  dates: DateOption[];
  /** Longer than this needs approval; at this length or longer, a note. */
  autoApproveMaxHours: number;
  /** Shortest allowed reservation, in minutes. */
  minReservationMinutes: number;
  /** The minute grid every time snaps to. */
  stepMinutes: number;
  /** Where an enquiry about somebody else's booking goes. */
  contact: { phone: string; email: string };
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
  // Apart from `error` so it can sit at the note box, like the live check.
  const [noteError, setNoteError] = useState("");
  // What the server refused and why, so Reserve cannot repeat it.
  const [refused, setRefused] = useState<{
    attempt: string;
    message: string;
  } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mine, setMine] = useState<MineEntry[]>([]);

  // Who's booking. No account, so these come with every reservation.
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [guestError, setGuestError] = useState<{
    field: GuestField;
    error: string;
  } | null>(null);

  // Turnstile reserves its box, so the slot stays collapsed until challenged.
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

  // Reload on booth or date change; a request id stops a slow response winning.
  const reqId = useRef(0);
  const loadAvailability = useCallback(
    async ({
      fresh = false,
      keepPick = false,
    }: { fresh?: boolean; keepPick?: boolean } = {}) => {
      if (!boothId || !date) return;
      const id = ++reqId.current;
      setLoading(true);
      try {
        const res = await fetch(
          // `fresh` is for after a booking, where the edge's 30s copy would omit it.
          `/api/availability?${availabilityQuery(boothId, date, fresh ? Date.now() : undefined)}`,
          // This browser's cache only: the CDN ignores it, hence the fresh URL.
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok: boolean } & Availability;
        if (id !== reqId.current) return;
        const owned = readMine();
        setMine(owned);
        setAvail(
          json.ok
            ? {
                ...json,
                reserved: json.reserved.map((b) => {
                  const held = owned.find(
                    (m) => m.k === slotKey(boothId, `${date}T${b.start}`),
                  );
                  return {
                    ...b,
                    mine: !!held,
                    cancelToken: held?.t || undefined,
                  };
                }),
              }
            : null,
        );
        // A reload that did not change the board keeps the pick.
        if (!keepPick) {
          setStart("");
          setEnd("");
        }
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [boothId, date],
  );

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  // A banner speaks about its own board, so another day is another subject.
  useEffect(() => {
    setSuccess(null);
    setError("");
    setNoteError("");
    setRefused(null);
  }, [boothId, date]);

  // A confirmation is a moment, not a state, so it retires itself.
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), SUCCESS_MS);
    return () => window.clearTimeout(timer);
  }, [success]);

  const startMin = start ? timeToMinutes(start) : null;
  const endMin = end ? timeToMinutes(end) : null;
  const duration = startMin != null && endMin != null ? endMin - startMin : 0;

  // The run belongs to whoever is booking, so it waits for a name.
  const booker = isValidEmail(email.trim()) ? canonicalEmail(email) : "";

  // That person's other bookings that day, so the run rule can warn early.
  const myHeld = useMemo(
    () =>
      heldRangesFor({
        entries: mine,
        booker,
        boothId,
        date,
        boardStarts: (avail?.reserved ?? []).map((b) => b.start),
      }),
    [mine, avail, boothId, date, booker],
  );

  // Reservable free stretches; with none, the picker gives way to the reason.
  const freeGaps = useMemo(() => {
    if (!avail) return [];
    const dayEnd = timeToMinutes(avail.closes);
    const busy = avail.reserved
      .map((b) => ({ from: timeToMinutes(b.start), to: timeToMinutes(b.end) }))
      .sort((a, b) => a.from - b.from);
    let cursor = Math.max(
      timeToMinutes(avail.opens),
      timeToMinutes(avail.earliest),
    );
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
    !!avail && timeToMinutes(avail.earliest) >= timeToMinutes(avail.closes);

  // Every route check the browser can make; nothing is judged before a board.
  const check = checkBooking({
    startMin: avail && start ? startMin : null,
    endMin: avail && end ? endMin : null,
    openMin: avail ? timeToMinutes(avail.opens) : 0,
    closeMin: avail ? timeToMinutes(avail.closes) : 0,
    earliestMin: avail ? timeToMinutes(avail.earliest) : 0,
    reserved: (avail?.reserved ?? []).map((b) => ({
      start: timeToMinutes(b.start),
      end: timeToMinutes(b.end),
      label: b.label,
    })),
    held: myHeld,
    note,
    stepMinutes,
    minReservationMinutes,
    autoApproveMaxHours,
  });
  const { mustNote, needsApproval: willNeedApproval } = check;
  // Not live: the picker re-seeds, so it would scold a range nobody chose.
  const problem = isBlocking(check) ? check.problem : "";

  // What the server judged, so its verdict expires the moment any of it changes.
  const attempt = `${boothId}|${date}|${start}|${end}|${booker}`;
  const refusal = refused?.attempt === attempt ? refused.message : "";
  const canReserve = !!start && !!end && !problem && !reservation && !refusal;

  /** Clear a field's error as soon as it's edited, so it can't linger. */
  const onGuestEdit = (field: GuestField, set: (v: string) => void) => {
    return (value: string) => {
      set(value);
      setError("");
      // The run counted was that email's, so a new address voids the verdict.
      if (field === "email") setNoteError("");
      if (guestError?.field === field) setGuestError(null);
    };
  };

  async function reserve() {
    if (!canReserve) return;

    // The route's own validator, so the client cannot submit a rejection.
    const guest = validateGuest({ fullName, email });
    if (!guest.ok) {
      setGuestError({ field: guest.field, error: guest.error });
      document.getElementById(guest.field)?.focus();
      return;
    }
    setGuestError(null);

    // Held back, so the ask lands on the booking attempt, not a picker move.
    if (check.field === "note") {
      setNoteError(check.problem);
      document.getElementById("note")?.focus();
      return;
    }

    // Reveal the widget rather than refuse a token nobody could earn.
    if (turnstileSiteKey && !turnstileToken) {
      setChallenging(true);
      setError("Please complete the human check below, then reserve again.");
      return;
    }

    setReservation(true);
    setError("");
    setNoteError("");
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
        field?: GuestField | "note";
        reservation?: Reservation;
        cancelToken?: string;
      };
      if (res.ok && json.ok) {
        // An earlier verdict described a world that is gone; the picker re-seeds.
        setRefused(null);
        const booth = booths.find((b) => b.id === boothId)?.name ?? "Booth";
        const when = `${booth} on ${formatDateLong(date)}, ${start} - ${end}`;
        setSuccess(
          json.reservation?.status === "pending"
            ? `Request submitted: ${when}. Reservations over ${autoApproveMaxHours} hours need admin approval - we'll email you once it's reviewed. The slot is held for you meanwhile.`
            : `Reserved ${when}. We've emailed ${guest.guest.email} a confirmation, with a link to cancel if your plans change.`,
        );
        setNote("");
        // Recorded before the reload, so the block comes back labelled "You".
        const made = json.reservation;
        if (made?.startsAt && made.endsAt) {
          setMine(
            rememberMine({
              k: slotKey(boothId, made.startsAt),
              s: made.startsAt,
              e: made.endsAt,
              m: guest.guest.email,
              t: json.cancelToken ?? "",
            }),
          );
        }
        await loadAvailability({ fresh: true });
      } else {
        const message = json.error || "Could not reserve that time.";
        const field = json.field;
        // Shown at the field it names, so a long form cannot hide the reason.
        if (field === "note") setNoteError(message);
        else if (field) setGuestError({ field, error: message });
        // A verdict on the pick: it stands until the range or booker changes.
        else if (res.status === 400 || res.status === 409)
          setRefused({ attempt, message });
        else setError(message);
        if (field) document.getElementById(field)?.focus();
        // Someone may have just taken it, which the cached board would not show.
        loadAvailability({ fresh: true, keepPick: true });
      }
    } finally {
      setReservation(false);
      // A token is single-use, so a retry or a second booking needs a fresh one.
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
        <div className="page-head">
          <span className="eyebrow">Innospace Tirana</span>
          <h1 className="page-title">Reserve a meeting booth</h1>
          <p className="page-subtitle">
            No account needed. Pick a booth and a time, tell us who you are, and
            we&apos;ll email you the confirmation. Reservations of{" "}
            {autoApproveMaxHours} hours or more need a note saying what the
            booth is for, and anything over {autoApproveMaxHours} hours needs
            admin approval before it&apos;s confirmed (the slot is held for you
            meanwhile).
          </p>
        </div>

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
                      // A moved start drags the end, keeping the pair bookable.
                      const reanchored =
                        from === start
                          ? null
                          : endForStart(
                              timeToMinutes(from),
                              freeGaps,
                              minReservationMinutes,
                              PREFERRED_MINUTES,
                            );
                      setStart(from);
                      setEnd(
                        reanchored == null ? to : minutesToTime(reanchored),
                      );
                      setError("");
                      setNoteError("");
                    }}
                    defaultRange={{
                      from: minutesToTime(freeGaps[0].from),
                      to: minutesToTime(
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
                step={stepMinutes}
                minMinutes={minReservationMinutes}
                contact={contact}
                boothName={selectedBooth?.name ?? "the booth"}
                dateLabel={dates.find((d) => d.value === date)?.label ?? date}
                // Cancelled from the board, so the graph must refetch.
                onCancelled={() => {
                  setSuccess(
                    "Your reservation is cancelled. The slot is free for someone else now.",
                  );
                  setError("");
                  // Freeing a slot can undo the very reason a pick was refused.
                  setRefused(null);
                  loadAvailability({ fresh: true, keepPick: true });
                }}
                // Another way to choose a range, writing the same state.
                onPick={(from, to) => {
                  setStart(from);
                  setEnd(to);
                  setError("");
                  setNoteError("");
                }}
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
                placeholder="you@example.com"
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
        {noteError && <p className="error">{noteError}</p>}
        <textarea
          id="note"
          name="note"
          aria-label="Note"
          className={`note-box ${(mustNote && !note.trim()) || noteError ? "required" : ""}`}
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
            setNoteError("");
          }}
          aria-required={mustNote}
        />

        {/* Collapsed until Cloudflare challenges, so an ordinary booking sees no gap. */}
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
        {(refusal || error) && <p className="error">{refusal || error}</p>}
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
