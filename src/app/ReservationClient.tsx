"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Script from "next/script";
import TimeRangePicker from "./TimeRangePicker";
import DayTimeline from "./DayTimeline";
import { SiteFooter } from "@/components/SiteFooter";
import { Topbar } from "@/components/Topbar";
import {
  MAX_EMAIL,
  MAX_NAME,
  MAX_NOTE,
  type Booth,
  type Reservation,
} from "@/lib/types";
import {
  canonicalEmail,
  guestProblems,
  isValidEmail,
  validateGuest,
  type GuestField,
} from "@/lib/guest";
import {
  attemptKey,
  checkBooking,
  isBlocking,
  noteAsk,
  NO_VERDICTS,
  verdictFor,
  withVerdict,
} from "@/lib/booking-check";
import {
  availabilityQuery,
  countsForDate,
  edgeMayBeStale,
  reservationCountLabel,
} from "@/lib/availability-url";
import {
  heldRangesFor,
  markMine,
  readMine,
  rememberMine,
  slotKey,
  type BoardSlot,
  type MineEntry,
  type ReservedSlot,
} from "@/lib/mine";
import {
  endForStart,
  findFreeGaps,
  isDayOver,
  seedGap,
  suggestedEndMin,
  wantedStartMin,
} from "@/lib/timeline";
import { dayEndMinute } from "@/lib/reservation-rules";
import {
  formatDateLong,
  formatDuration,
  minutesToTime,
  timeToMinutes,
} from "@/lib/datetime";

interface Availability {
  /** The day this board answers for, so no count shows against another date. */
  date: string;
  reserved: ReservedSlot[];
  /** Active reservations per booth; absent on a copy cached before a deploy. */
  counts?: Record<string, number>;
  earliest: string;
}

interface DateOption {
  value: string;
  label: string;
}

// The length a booking opens on and a moved start re-anchors its end to.
const PREFERRED_MINUTES = 60;

// Where an untouched day opens the picker.
const PREFERRED_START_MIN = 9 * 60;

// How long a confirmation stays up; the email repeats it, so nothing is lost.
const SUCCESS_MS = 5000;

declare global {
  interface Window {
    // Injected by Cloudflare's Turnstile script when the booking widget is on.
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
  minReservationMinutes: number;
  /** The minute grid every time snaps to. */
  stepMinutes: number;
  /** Where an enquiry about somebody else's booking goes. */
  contact: { phone: string; email: string };
  /** Undefined when Turnstile is switched off. */
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
  // What the server refused and why, so Reserve cannot repeat it.
  const [refused, setRefused] = useState(NO_VERDICTS);
  // Notes the server asked for, as it counts runs this board cannot see.
  const [noteDemands, setNoteDemands] = useState(NO_VERDICTS);
  // The attempt Reserve last asked a note for; a server demand needs no mark.
  const [askedFor, setAskedFor] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mine, setMine] = useState<MineEntry[]>([]);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  // Shown as a red field only, so every failing field is held.
  const [guestErrors, setGuestErrors] = useState<
    Partial<Record<GuestField, string>>
  >({});

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

  // When this browser last wrote, so later loads skip the edge's older copy.
  const wroteAt = useRef(0);

  // A request id stops a slow response winning.
  const reqId = useRef(0);
  const loadAvailability = useCallback(
    async ({
      fresh = false,
      keepPick = false,
    }: { fresh?: boolean; keepPick?: boolean } = {}) => {
      if (!boothId || !date) return;
      const id = ++reqId.current;
      // A refresh of the board on screen happens in place, so nothing unmounts.
      if (!keepPick) setLoading(true);
      // Another booth's cached board predates the write too, undoing its count.
      const bust = fresh || edgeMayBeStale(Date.now(), wroteAt.current);
      try {
        const res = await fetch(
          // After a booking the edge's 30s copy would omit it, hence `fresh`.
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
        // A reload that did not change the board keeps the pick.
        if (!keepPick) {
          setStart("");
          setEnd("");
        }
      } catch {
        // A dropped connection or a non-JSON reply: no board beats a stale one.
        if (id === reqId.current) setAvail(null);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [boothId, date],
  );

  // The newest loader, so a late reply reloads the board on screen.
  const reload = useRef(loadAvailability);
  useEffect(() => {
    reload.current = loadAvailability;
    loadAvailability();
  }, [loadAvailability]);

  // Banners and errors belong to the board they were raised on.
  useEffect(() => {
    setSuccess(null);
    setError("");
    setRefused(NO_VERDICTS);
    setNoteDemands(NO_VERDICTS);
    setAskedFor(null);
    setGuestErrors({});
    // Dropped at once, so Reserve waits for the new board whichever reload wins.
    setStart("");
    setEnd("");
  }, [boothId, date]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), SUCCESS_MS);
    return () => window.clearTimeout(timer);
  }, [success]);

  const startMin = start ? timeToMinutes(start) : null;
  const endMin = end ? timeToMinutes(end) : null;
  const duration = startMin != null && endMin != null ? endMin - startMin : 0;

  // The run belongs to whoever is booking, so it waits for a valid email.
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

  // No opening hours: the day runs to the last grid step a booking may end on.
  const dayEnd = dayEndMinute(stepMinutes);

  // Reservable free stretches; with none, the picker gives way to the reason.
  const freeGaps = useMemo(() => {
    if (!avail) return [];
    return findFreeGaps(
      avail.reserved.map((b) => ({
        start: timeToMinutes(b.start),
        end: timeToMinutes(b.end),
      })),
      timeToMinutes(avail.earliest),
      dayEnd,
      minReservationMinutes,
    );
  }, [avail, dayEnd, minReservationMinutes]);

  const earliestMin = avail ? timeToMinutes(avail.earliest) : 0;
  const noTimeLeft = !!avail && freeGaps.length === 0;
  const dayIsOver =
    !!avail && isDayOver(earliestMin, dayEnd, minReservationMinutes);
  // Mid-morning for an untouched day, since midnight is nobody's first guess.
  const seed = seedGap(
    freeGaps,
    wantedStartMin(earliestMin, PREFERRED_START_MIN),
    minReservationMinutes,
  );

  // Every route check the browser can make; nothing is judged before a board.
  const check = checkBooking({
    startMin: avail && start ? startMin : null,
    endMin: avail && end ? endMin : null,
    earliestMin,
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

  // What the server judged, so its verdict expires once any of it changes.
  const attempt = attemptKey({ boothId, date, start, end, booker });
  const refusal = verdictFor(refused, attempt);
  // Outlives typing in the note box, which does not change the attempt.
  const demanded = verdictFor(noteDemands, attempt);
  const noteNeeded = mustNote || !!demanded;
  const ask = noteAsk(check, demanded, note);
  // Derived, so it cannot outlive its attempt; a demand is proof a press asked.
  const noteError = demanded || askedFor === attempt ? ask : "";

  // The attempt on screen now, for a reply landing after the form moved on.
  const liveAttempt = useRef(attempt);
  useEffect(() => {
    liveAttempt.current = attempt;
  }, [attempt]);
  const canReserve =
    !!avail && !!start && !!end && !problem && !reservation && !refusal;

  // A reply must not pull focus from a field the user has since moved into.
  const focusUnlessBusy = (id: string) => {
    const at = document.activeElement;
    const idle = !at || at === document.body || !!at.closest(".reserve-bar");
    if (idle || at.id === id) document.getElementById(id)?.focus();
  };

  const onGuestEdit = (field: GuestField, set: (v: string) => void) => {
    return (value: string) => {
      set(value);
      setError("");
      if (guestErrors[field]) setGuestErrors({ ...guestErrors, [field]: "" });
    };
  };

  async function reserve() {
    if (!canReserve) return;

    // The route's own validator, so the client cannot submit a rejection.
    const guest = validateGuest({ fullName, email });
    if (!guest.ok) {
      // Rendered before the focus, so the reason is there when the field is read.
      flushSync(() => setGuestErrors(guestProblems({ fullName, email })));
      document.getElementById(guest.field)?.focus();
      return;
    }
    setGuestErrors({});

    // Held back, so the ask lands on the booking attempt, not a picker move.
    if (ask) {
      // Rendered before the focus, so the prompt is there when the box is read.
      flushSync(() => setAskedFor(attempt));
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
      const booth = booths.find((b) => b.id === boothId)?.name ?? "Booth";
      const when = `${booth} on ${formatDateLong(date)}, ${start} - ${end}`;
      if (res.ok && json.ok) {
        // An earlier verdict described a world now gone; the picker re-seeds.
        setRefused(NO_VERDICTS);
        setNoteDemands(NO_VERDICTS);
        setAskedFor(null);
        wroteAt.current = Date.now();
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
        await reload.current({ fresh: true });
      } else {
        const message = json.error || "Could not reserve that time.";
        const field = json.field;
        // A blank note refused is a demand; any other fault is in the text.
        const needsNote = field === "note" && !note.trim();
        const onPick = !field && (res.status === 400 || res.status === 409);
        // Keyed to the attempt, so these stand for it alone wherever the form is.
        const record = () => {
          if (needsNote)
            setNoteDemands((d) => withVerdict(d, attempt, message));
          else if (onPick) setRefused((r) => withVerdict(r, attempt, message));
        };
        if (liveAttempt.current !== attempt) {
          record();
          // The form moved on mid-request: name what failed, mark nothing here.
          setError(`${when} was not reserved. ${message}`);
        } else {
          // Rendered before the focus, so the reason is there when it is read.
          flushSync(() => {
            record();
            if (field && field !== "note") setGuestErrors({ [field]: message });
            else if (!needsNote && !onPick) setError(message);
          });
          if (field) focusUnlessBusy(field);
        }
        // Someone may have just taken it, which a cached board would not show.
        reload.current({ fresh: true, keepPick: true });
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setReservation(false);
      // A token is single-use, so a retry or second booking needs a fresh one.
      if (turnstileSiteKey) {
        setTurnstileToken("");
        window.turnstile?.reset(widgetIdRef.current ?? undefined);
      }
    }
  }

  const selectedBooth = booths.find((b) => b.id === boothId);
  // The previous date's board lingers until the new one lands.
  const counts = countsForDate(avail, date);
  const fieldError = (field: GuestField) => guestErrors[field] ?? "";

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
              {/* Always rendered, so cards do not grow when counts land. */}
              <span className="booth-count">
                {counts?.[b.id] == null
                  ? " "
                  : reservationCountLabel(counts[b.id])}
              </span>
            </button>
          ))}
        </div>

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

        <div className="field-label">Time</div>
        <div className="card time-card">
          {loading ? (
            <span className="muted">Loading availability…</span>
          ) : !avail ? (
            <div className="load-failed">
              <span className="muted">Couldn&apos;t load availability.</span>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => loadAvailability()}
              >
                Try again
              </button>
            </div>
          ) : noTimeLeft || !seed ? (
            <div className="empty">
              {dayIsOver
                ? "There's no time left to reserve today. Pick another date."
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
                    }}
                    defaultRange={{
                      from: minutesToTime(seed.from),
                      to: minutesToTime(
                        suggestedEndMin(
                          seed.from,
                          seed.to,
                          minReservationMinutes,
                          PREFERRED_MINUTES,
                        ) ?? seed.to,
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
                earliest={avail.earliest}
                reserved={avail.reserved}
                selection={start && end ? { start, end } : null}
                step={stepMinutes}
                minMinutes={minReservationMinutes}
                contact={contact}
                boothName={selectedBooth?.name ?? "the booth"}
                dateLabel={dates.find((d) => d.value === date)?.label ?? date}
                onCancelled={() => {
                  setSuccess(
                    "Your reservation is cancelled. The slot is free for someone else now.",
                  );
                  setError("");
                  // A freed slot can undo a refusal or a note demand.
                  setRefused(NO_VERDICTS);
                  setNoteDemands(NO_VERDICTS);
                  wroteAt.current = Date.now();
                  reload.current({ fresh: true, keepPick: true });
                }}
                onPick={(from, to) => {
                  setStart(from);
                  setEnd(to);
                  setError("");
                }}
              />
            </>
          )}
        </div>

        <div className="field-label">Your details</div>
        <div className="card guest-card">
          <div className="guest-row">
            <label className="guest-field">
              <span>
                Full name <b aria-hidden="true">*</b>
              </span>
              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                placeholder="First and last name"
                maxLength={MAX_NAME}
                required
                aria-invalid={!!fieldError("fullName")}
                aria-describedby={
                  fieldError("fullName") ? "fullName-error" : undefined
                }
                className={fieldError("fullName") ? "invalid" : ""}
                value={fullName}
                onChange={(e) =>
                  onGuestEdit("fullName", setFullName)(e.target.value)
                }
              />
            </label>
            <label className="guest-field">
              <span>
                Email <b aria-hidden="true">*</b>
              </span>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                maxLength={MAX_EMAIL}
                required
                aria-invalid={!!fieldError("email")}
                aria-describedby={
                  fieldError("email") ? "email-error" : undefined
                }
                className={fieldError("email") ? "invalid" : ""}
                value={email}
                onChange={(e) => onGuestEdit("email", setEmail)(e.target.value)}
              />
            </label>
          </div>
          {/* A red field is the only visible cue; its reason is read on focus. */}
          <span id="fullName-error" className="sr-only">
            {fieldError("fullName")}
          </span>
          <span id="email-error" className="sr-only">
            {fieldError("email")}
          </span>
        </div>

        {noteError && (
          <p id="note-error" className="error">
            {noteError}
          </p>
        )}
        <textarea
          id="note"
          name="note"
          aria-label="Note"
          className={`note-box ${noteNeeded && !note.trim() ? "required" : ""}`}
          placeholder={
            noteNeeded
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
          aria-required={noteNeeded}
          aria-invalid={!!noteError}
          aria-describedby={noteError ? "note-error" : undefined}
        />

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
