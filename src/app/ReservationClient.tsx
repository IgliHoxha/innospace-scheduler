"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Script from "next/script";
import TimeRangePicker from "./TimeRangePicker";
import DayTimeline from "./DayTimeline";
import { BoothGrid } from "./_booking/BoothGrid";
import { DateChips, type DateOption } from "./_booking/DateChips";
import { GuestCard, type GuestErrors } from "./_booking/GuestCard";
import { RepeatCard } from "./_booking/RepeatCard";
import { ReserveBar } from "./_booking/ReserveBar";
import { TimeCard } from "./_booking/TimeCard";
import { useAvailability } from "./_booking/use-availability";
import { useMember } from "./_booking/use-member";
import { useTurnstile } from "./_booking/use-turnstile";
import { SiteFooter } from "@/components/SiteFooter";
import { Topbar } from "@/components/Topbar";
import { MAX_NOTE, type Booth, type Reservation } from "@/lib/types";
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
import { bookedMessage, bookingWhen } from "@/lib/booking-messages";
import { countsForDate } from "@/lib/availability-url";
import { heldRangesFor, rememberMine, slotKey } from "@/lib/mine";
import {
  endForStart,
  findFreeGaps,
  isDayOver,
  seedGap,
  suggestedEndMin,
  wantedStartMin,
} from "@/lib/timeline";
import { dayEndMinute } from "@/lib/reservation-rules";
import { formatDuration, minutesToTime, timeToMinutes } from "@/lib/datetime";

const SIGN_IN_FAILED_MESSAGE =
  "Google sign-in didn't complete. You can still book as a guest below.";

// The length a booking opens on and a moved start re-anchors its end to.
const PREFERRED_MINUTES = 60;

const PREFERRED_START_MIN = 9 * 60;

// How long a confirmation stays up; the email repeats it, so nothing is lost.
const SUCCESS_MS = 5000;

export default function ReservationClient({
  booths,
  dates,
  autoApproveMaxHours,
  minReservationMinutes,
  stepMinutes,
  contact,
  turnstileSiteKey: configuredSiteKey,
  googleSignIn = false,
  signInFailed = false,
  maxRepeatWeeks = 1,
}: {
  booths: Booth[];
  dates: DateOption[];
  /** Longer than this needs approval; at this length or longer, a note. */
  autoApproveMaxHours: number;
  minReservationMinutes: number;
  stepMinutes: number;
  /** Where an enquiry about somebody else's booking goes. */
  contact: { phone: string; email: string };
  /** Undefined when Turnstile is switched off. */
  turnstileSiteKey?: string;
  googleSignIn?: boolean;
  /** Google sent the person back without a session. */
  signInFailed?: boolean;
  maxRepeatWeeks?: number;
}) {
  const member = useMember();

  // Google already vouched for a member, so the bot check is for guests only.
  const turnstileSiteKey = member === null ? configuredSiteKey : undefined;
  const turnstile = useTurnstile(turnstileSiteKey);

  const [boothId, setBoothId] = useState(booths[0]?.id ?? "");
  const [date, setDate] = useState(dates[0]?.value ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [reservation, setReservation] = useState(false);
  const [error, setError] = useState("");
  // What the server refused and why, so Reserve cannot repeat it.
  const [refused, setRefused] = useState(NO_VERDICTS);
  // Notes the server asked for, as it counts runs this board cannot see.
  const [noteDemands, setNoteDemands] = useState(NO_VERDICTS);
  // The attempt Reserve last asked a note for; a server demand needs no mark.
  const [askedFor, setAskedFor] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Outlives the board resets, since it answers a redirect, not a pick.
  const [signInNotice, setSignInNotice] = useState(
    signInFailed ? SIGN_IN_FAILED_MESSAGE : "",
  );
  // Members only: a guest has no session for the later dates to come back to.
  const [repeatWeeks, setRepeatWeeks] = useState(1);
  const [guest, setGuest] = useState<Record<GuestField, string>>({
    fullName: "",
    email: "",
  });
  // Shown as a red field only, so every failing field is held.
  const [guestErrors, setGuestErrors] = useState<GuestErrors>({});

  const clearPick = useCallback(() => {
    setStart("");
    setEnd("");
  }, []);
  const { avail, loading, mine, setMine, load, reload, noteWrite } =
    useAvailability(boothId, date, clearPick);

  // Banners and errors belong to the board they were raised on.
  useEffect(() => {
    setSuccess(null);
    setError("");
    setRefused(NO_VERDICTS);
    setNoteDemands(NO_VERDICTS);
    setAskedFor(null);
    setGuestErrors({});
    // Dropped at once, so Reserve waits for the new board whichever reload wins.
    clearPick();
  }, [boothId, date, clearPick]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), SUCCESS_MS);
    return () => window.clearTimeout(timer);
  }, [success]);

  const startMin = start ? timeToMinutes(start) : null;
  const endMin = end ? timeToMinutes(end) : null;
  const duration = startMin != null && endMin != null ? endMin - startMin : 0;

  // The run belongs to whoever is booking, so it waits for a valid email.
  const booker = member
    ? canonicalEmail(member.email)
    : isValidEmail(guest.email.trim())
      ? canonicalEmail(guest.email)
      : "";

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
  const attempt = attemptKey({
    boothId,
    date,
    start,
    end,
    booker,
    repeatWeeks,
  });
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
  // Waits for /api/me too, or a member's first press would book as a guest.
  const canReserve =
    !!avail &&
    !!start &&
    !!end &&
    !problem &&
    !reservation &&
    !refusal &&
    member !== undefined;

  const selectedBooth = booths.find((b) => b.id === boothId);
  const dateLabel = dates.find((d) => d.value === date)?.label;

  // A reply must not pull focus from a field the user has since moved into.
  const focusUnlessBusy = (id: string) => {
    const at = document.activeElement;
    const idle = !at || at === document.body || !!at.closest(".reserve-bar");
    if (idle || at.id === id) document.getElementById(id)?.focus();
  };

  const editGuest = (field: GuestField, value: string) => {
    setGuest((g) => ({ ...g, [field]: value }));
    setError("");
    if (guestErrors[field]) setGuestErrors({ ...guestErrors, [field]: "" });
  };

  // A moved start drags the end, keeping the pair bookable.
  const editRange = ({ from, to }: { from: string; to: string }) => {
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
    setEnd(reanchored == null ? to : minutesToTime(reanchored));
    setError("");
  };

  async function reserve() {
    if (!canReserve) return;
    setSignInNotice("");

    // The route's own validator, so the client cannot submit a rejection.
    const who = member
      ? {
          ok: true as const,
          guest: { fullName: member.name, email: member.email },
        }
      : validateGuest(guest);
    if (!who.ok) {
      // Rendered before the focus, so the reason is there when the field is read.
      flushSync(() => setGuestErrors(guestProblems(guest)));
      document.getElementById(who.field)?.focus();
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

    if (turnstileSiteKey && !turnstile.token) {
      turnstile.challenge();
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
          turnstileToken: turnstile.token,
          // A member's identity comes from their session, never the body.
          ...(member ? {} : who.guest),
          ...(repeatWeeks > 1 ? { repeatWeeks } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok: boolean;
        error?: string;
        field?: GuestField | "note";
        reservation?: Reservation;
        reservations?: (Reservation & { cancelToken?: string })[];
        cancelToken?: string;
      };
      const when = bookingWhen({
        boothName: selectedBooth?.name ?? "Booth",
        date,
        start,
        end,
        repeatWeeks,
      });
      if (res.ok && json.ok) {
        // An earlier verdict described a world now gone; the picker re-seeds.
        setRefused(NO_VERDICTS);
        setNoteDemands(NO_VERDICTS);
        setAskedFor(null);
        noteWrite();
        setSuccess(
          bookedMessage({
            when,
            pending: json.reservation?.status === "pending",
            repeatWeeks,
            autoApproveMaxHours,
            email: who.guest.email,
          }),
        );
        setNote("");
        setRepeatWeeks(1);
        // Recorded before the reload, so the block comes back labelled "You".
        const made = json.reservations ?? [
          { ...json.reservation, cancelToken: json.cancelToken },
        ];
        let owned = mine;
        for (const r of made) {
          if (!r?.startsAt || !r.endsAt) continue;
          owned = rememberMine({
            k: slotKey(boothId, r.startsAt),
            s: r.startsAt,
            e: r.endsAt,
            m: who.guest.email,
            t: r.cancelToken ?? "",
          });
        }
        setMine(owned);
        await reload({ fresh: true });
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
        reload({ fresh: true, keepPick: true });
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setReservation(false);
      if (turnstileSiteKey) turnstile.spend();
    }
  }

  return (
    <>
      {/* A member signs out from the top bar, back to this screen as a guest. */}
      <Topbar
        brandHref="/"
        brandLabel="Innospace Scheduler"
        username={member?.name}
        email={member?.email}
        signOutTo="/"
      />

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

        <BoothGrid
          booths={booths}
          selected={boothId}
          // The previous date's board lingers until the new one lands.
          counts={countsForDate(avail, date)}
          onSelect={setBoothId}
        />

        <DateChips dates={dates} selected={date} onSelect={setDate} />

        <TimeCard
          loading={loading}
          loaded={!!avail}
          empty={noTimeLeft || !seed}
          dayIsOver={dayIsOver}
          onRetry={() => load()}
        >
          {avail && seed && (
            <>
              <div className="time-row">
                <div className="time-field">
                  <span>Start &amp; end</span>
                  <TimeRangePicker
                    value={start && end ? { from: start, to: end } : null}
                    onChange={editRange}
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
                dateLabel={dateLabel ?? date}
                onCancelled={() => {
                  setSuccess(
                    "Your reservation is cancelled. The slot is free for someone else now.",
                  );
                  setError("");
                  // A freed slot can undo a refusal or a note demand.
                  setRefused(NO_VERDICTS);
                  setNoteDemands(NO_VERDICTS);
                  noteWrite();
                  reload({ fresh: true, keepPick: true });
                }}
                onPick={(from, to) => {
                  setStart(from);
                  setEnd(to);
                  setError("");
                }}
              />
            </>
          )}
        </TimeCard>

        {/* A member is named in the top bar, so the details card gives way to the repeat. */}
        {member === undefined ? null : member ? (
          maxRepeatWeeks > 1 && (
            <RepeatCard
              weeks={repeatWeeks}
              maxWeeks={maxRepeatWeeks}
              onChange={(weeks) => {
                setRepeatWeeks(weeks);
                setError("");
              }}
            />
          )
        ) : (
          <GuestCard
            values={guest}
            errors={guestErrors}
            onEdit={editGuest}
            googleSignIn={googleSignIn}
          />
        )}

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
              ref={turnstile.slotRef}
              className={`turnstile-slot ${turnstile.challenging ? "is-challenging" : ""}`}
            />
          </>
        )}

        {signInNotice && <p className="error">{signInNotice}</p>}
        {problem && <p className="error">{problem}</p>}
        {(refusal || error) && <p className="error">{refusal || error}</p>}
        {success && <p className="success">{success}</p>}

        <ReserveBar
          summary={
            start && end && !problem
              ? { booth: selectedBooth?.name, day: dateLabel, start, end }
              : null
          }
          repeatWeeks={repeatWeeks}
          needsApproval={willNeedApproval}
          canReserve={canReserve}
          busy={reservation}
          onReserve={reserve}
        />
      </div>

      <SiteFooter />
    </>
  );
}
