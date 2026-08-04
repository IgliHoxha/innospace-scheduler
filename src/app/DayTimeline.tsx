"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildDaySegments,
  dragRange,
  pickTagPlacement,
  tickMinutes,
} from "@/lib/timeline";
import { minutesToTime, timeToMinutes } from "@/lib/datetime";
import { mailtoLink, slotEnquiry, whatsappLink } from "@/lib/contact-links";
import { MailIcon, TrashIcon, WhatsAppIcon } from "@/components/ui/icons";
import { useTooltip } from "@/components/ui/tooltip";

/** A reservation already taken for the booth+day, times as "HH:MM". */
interface Reserved {
  start: string;
  end: string;
  label: string;
  /** Booked from this browser; the board never learns who anyone else is. */
  mine: boolean;
  /** Present only for a booking this browser made: the proof needed to cancel it. */
  cancelToken?: string;
}

// A pick narrower than this (px) can't hold its time tag, so the tag floats beside it.
const TAG_FITS_PX = 96;

// Travel (px) before a press is a drag; below it the gesture stays a click and keeps its hour.
const DRAG_SLOP_PX = 4;

// Room (px) one "HH:MM" tick needs before it touches its neighbour, so a narrow bar shows fewer.
const TICK_LABEL_PX = 44;

/** Availability graph for one booth+day; with `onPick` it also picks the range, by click or drag. */
export default function DayTimeline({
  opens,
  closes,
  earliest,
  reserved,
  selection,
  onPick,
  step,
  minMinutes,
  contact,
  onCancelled,
  boothName = "booth",
  dateLabel = "that day",
}: {
  opens: string;
  closes: string;
  earliest: string;
  reserved: Reserved[];
  selection: { start: string; end: string } | null;
  /** Called with "HH:MM" bounds as the pick changes. Omit for a read-only graph. */
  onPick?: (start: string, end: string) => void;
  /** TIME_STEP_MINUTES: the grid a drag snaps to. A click takes the whole hour. */
  step: number;
  /** MIN_RESERVATION_MINUTES, so a drag can't return a range the form rejects. */
  minMinutes: number;
  /** Where an enquiry about a taken slot goes. Omit and taken blocks stay inert. */
  contact?: { phone: string; email: string };
  /** Called after this browser cancels one of its own bookings, so the board can reload. */
  onCancelled?: () => void;
  boothName?: string;
  dateLabel?: string;
}) {
  const opensMin = timeToMinutes(opens);
  const closesMin = timeToMinutes(closes);
  const span = Math.max(1, closesMin - opensMin);
  const earliestMin = Math.max(opensMin, timeToMinutes(earliest));

  const pct = (min: number) =>
    Math.max(0, Math.min(100, ((min - opensMin) / span) * 100));

  const segments = buildDaySegments(
    opensMin,
    closesMin,
    reserved.map((r) => ({
      start: timeToMinutes(r.start),
      end: timeToMinutes(r.end),
      src: r,
    })),
  );

  const hourMarks: number[] = [];
  for (let h = Math.ceil(opensMin / 60) * 60; h <= closesMin; h += 60) {
    hourMarks.push(h);
  }
  // Edge ticks anchor to the bar's ends; inner ones centre on their mark.
  const tickStyle = (t: number) => {
    if (t <= opensMin) return { left: 0 };
    if (t >= closesMin) return { right: 0 };
    return { left: `${pct(t)}%`, transform: "translateX(-50%)" };
  };

  const selFrom = selection ? timeToMinutes(selection.start) : null;
  const selTo = selection ? timeToMinutes(selection.end) : null;
  const hasPick =
    selFrom != null && selTo != null && selTo > opensMin && selFrom < closesMin;

  // Measure the bar so a narrow pick can move its time tag outside the block.
  const barRef = useRef<HTMLDivElement>(null);
  const [barPx, setBarPx] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => setBarPx(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fewer marks get a label on a narrow bar, though the grid behind them still runs hourly.
  const tickLabels = tickMinutes(opensMin, closesMin, barPx, TICK_LABEL_PX);

  // The tag's own width, so a floating tag can be centred on its pick without leaving the bar.
  const [tagPx, setTagPx] = useState(0);
  const tagRo = useRef<ResizeObserver | null>(null);
  // A callback ref, since the tag mounts and unmounts with the pick and its width changes with its class.
  const tagRef = useCallback((el: HTMLDivElement | null) => {
    tagRo.current?.disconnect();
    if (!el) return;
    const update = () => setTagPx(el.offsetWidth);
    update();
    tagRo.current = new ResizeObserver(update);
    tagRo.current.observe(el);
  }, []);

  // One box per hour, pickable only if wholly free and not past.
  const cells: { from: number; to: number; free: boolean }[] = [];
  for (let m = opensMin; m < closesMin; m += 60) {
    const to = Math.min(m + 60, closesMin);
    cells.push({
      from: m,
      to,
      free:
        m >= earliestMin &&
        !segments.some((s) => s.reserved && s.fromMin < to && s.toMin > m),
    });
  }

  // The gesture in flight, in a ref so the window listeners read live values.
  const dragRef = useRef<{
    anchorMin: number;
    startX: number;
    cell: number;
    stretch: { from: number; to: number };
  } | null>(null);
  // Set once a press has travelled far enough to count as a drag rather than a click.
  const movedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  /** The minute under the pointer, measured on the bar rather than on a box. */
  const minuteAt = (clientX: number): number => {
    const el = barRef.current;
    if (!el) return opensMin;
    const r = el.getBoundingClientRect();
    return opensMin + ((clientX - r.left) / Math.max(1, r.width)) * span;
  };

  /** The free run of the day this hour box sits in, floored at "now". */
  const stretchFor = (i: number): { from: number; to: number } | null => {
    const c = cells[i];
    const s = segments.find(
      (g) => !g.reserved && g.fromMin < c.to && g.toMin > c.from,
    );
    return s ? { from: Math.max(s.fromMin, earliestMin), to: s.toMin } : null;
  };

  const pickCell = (i: number) => {
    if (onPick && cells[i].free) {
      onPick(minutesToTime(cells[i].from), minutesToTime(cells[i].to));
    }
  };

  // Rebound every render so the listeners run against this render's segments and size.
  const onStopRef = useRef<() => void>(() => {});
  onStopRef.current = () => {
    const d = dragRef.current;
    if (d && !movedRef.current) pickCell(d.cell);
  };

  const onMoveRef = useRef<(clientX: number) => void>(() => {});
  onMoveRef.current = (clientX) => {
    const d = dragRef.current;
    if (!d || !onPick) return;
    if (!movedRef.current) {
      if (Math.abs(clientX - d.startX) < DRAG_SLOP_PX) return;
      movedRef.current = true;
    }
    const r = dragRange(
      d.anchorMin,
      minuteAt(clientX),
      d.stretch,
      step,
      minMinutes,
    );
    onPick(minutesToTime(r.from), minutesToTime(r.to));
  };

  const { tooltip, tip } = useTooltip();

  // Keyed on the range, not an index, so the popover closes itself if that booking is gone.
  const [asking, setAsking] = useState<{ from: number; to: number } | null>(
    null,
  );
  const askOn =
    (asking &&
      segments.find(
        (s) => s.reserved && s.fromMin === asking.from && s.toMin === asking.to,
      )) ||
    null;
  const askMessage = askOn
    ? slotEnquiry(
        boothName,
        dateLabel,
        minutesToTime(askOn.fromMin),
        minutesToTime(askOn.toMin),
      )
    : "";
  const askSubject = askOn
    ? `Booking enquiry: ${boothName}, ${dateLabel} ${minutesToTime(askOn.fromMin)} - ${minutesToTime(askOn.toMin)}`
    : "";

  // Keyed on the range too, so a booking cancelled elsewhere takes its dialog with it.
  const [cancelling, setCancelling] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const cancelOn =
    (cancelling &&
      segments.find(
        (s) =>
          s.reserved &&
          s.fromMin === cancelling.from &&
          s.toMin === cancelling.to,
      )) ||
    null;
  const cancelToken = cancelOn?.reserved?.src.cancelToken ?? "";

  const closeCancel = () => {
    setCancelling(null);
    setCancelError("");
  };

  /** The emailed link's endpoint, with the token this browser kept when it booked. */
  async function confirmCancel() {
    if (!cancelToken) return;
    setCancelBusy(true);
    setCancelError("");
    try {
      const res = await fetch("/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: cancelToken }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && json.ok) {
        closeCancel();
        onCancelled?.();
      } else {
        setCancelError(json.error || "Could not cancel that reservation.");
      }
    } catch {
      setCancelError("Could not reach the server. Please try again.");
    } finally {
      setCancelBusy(false);
    }
  }

  // Escape closes whichever dialog is open; the overlay handles clicks outside.
  useEffect(() => {
    if (!askOn && !cancelOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAsking(null);
      if (!cancelBusy) closeCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [askOn, cancelOn, cancelBusy]);

  // Ends whatever gesture is running, for an unmount mid-drag.
  const endRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endRef.current?.(), []);

  /** Track the gesture on the window, subscribed here so no movement slips through a render. */
  const beginDrag = (i: number, clientX: number) => {
    const stretch = stretchFor(i);
    if (!stretch) return;
    // The box pressed, not the pixel: a drag and the click it might have been start alike.
    const anchorMin = Math.max(cells[i].from, stretch.from);
    movedRef.current = false;
    dragRef.current = {
      anchorMin,
      startX: clientX,
      cell: i,
      stretch,
    };

    const move = (e: PointerEvent) => onMoveRef.current(e.clientX);
    // A press that never travelled is a click, proven only on release; a cancel commits nothing.
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (commit) onStopRef.current();
      dragRef.current = null;
      endRef.current = null;
      setDragging(false);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    endRef.current = cancel;
    setDragging(true);
  };

  let tag: { className: string; style: React.CSSProperties } | null = null;
  if (hasPick) {
    const place = pickTagPlacement({
      barPx,
      tagPx,
      fromPct: pct(selFrom!),
      toPct: pct(selTo!),
      fitsPx: TAG_FITS_PX,
    });
    tag = {
      // Roomy pick: the tag sits inside it. Too tight: it floats above, clear of any neighbour.
      className: `daycal-pick-tag ${place.above ? "above" : "over"}`,
      style:
        place.leftPx == null
          ? {
              left: `${place.centerPct}%`,
              transform: place.above
                ? "translateX(-50%)"
                : "translate(-50%, -50%)",
            }
          : { left: place.leftPx },
    };
  }

  return (
    <div className="daycal">
      <div className="daycal-head">
        <span className="daycal-title">Availability</span>
      </div>

      <div
        className={`daycal-plot ${tag?.className.includes("above") ? "has-toptag" : ""}`}
      >
        <div
          className={`daycal-bar ${dragging ? "dragging" : ""}`}
          ref={barRef}
        >
          {hourMarks
            .filter((t) => t > opensMin && t < closesMin)
            .map((t) => (
              <div
                key={`g${t}`}
                className="daycal-grid"
                style={{ left: `${pct(t)}%` }}
              />
            ))}

          {earliestMin > opensMin && (
            <div
              className="daycal-past"
              style={{ left: 0, width: `${pct(earliestMin)}%` }}
              {...tooltip("Already passed")}
            />
          )}

          {segments.map((s) => {
            if (!s.reserved) return null;
            const src = s.reserved.src;
            // Only a booking this browser holds the token for can offer to cancel itself.
            const canCancel = !!src.cancelToken;
            const range = { from: s.fromMin, to: s.toMin };
            return (
              <button
                key={`${s.fromMin}-${s.toMin}`}
                type="button"
                className={`daycal-block ${src.mine ? "mine" : ""} ${canCancel ? "can-cancel" : ""}`}
                style={{
                  left: `${pct(s.fromMin)}%`,
                  width: `${pct(s.toMin) - pct(s.fromMin)}%`,
                }}
                {...tooltip(
                  canCancel
                    ? `Your booking, ${minutesToTime(s.fromMin)} - ${minutesToTime(s.toMin)} · click to cancel it`
                    : src.mine
                      ? `Your booking, ${minutesToTime(s.fromMin)} - ${minutesToTime(s.toMin)}${contact ? " · click to contact us about it" : ""}`
                      : `${minutesToTime(s.fromMin)} - ${minutesToTime(s.toMin)} · Booked${contact ? " - click to request information" : ""}`,
                )}
                aria-haspopup={canCancel || contact ? "dialog" : undefined}
                disabled={!canCancel && !contact}
                onClick={() =>
                  canCancel ? setCancelling(range) : setAsking(range)
                }
              >
                <span className="daycal-block-label">
                  {src.mine ? "You" : "Booked"}
                </span>
                {canCancel && (
                  <span className="daycal-block-label on-hover">
                    <TrashIcon />
                  </span>
                )}
              </button>
            );
          })}

          {hasPick && (
            <div
              // Against the bar's own end its border has to follow the curve, or the clip slices it.
              className={`daycal-pick ${pct(selFrom!) === 0 ? "at-start" : ""} ${
                pct(selTo!) === 100 ? "at-end" : ""
              }`}
              style={{
                left: `${pct(selFrom!)}%`,
                width: `${pct(selTo!) - pct(selFrom!)}%`,
              }}
            />
          )}

          {/* Above everything to take the pointer; taken hours opt out so their tooltips still work. */}
          {onPick &&
            cells.map((c, i) => (
              <button
                key={`c${c.from}`}
                type="button"
                className={`daycal-cell ${c.free ? "free" : "taken"}`}
                style={{
                  left: `${pct(c.from)}%`,
                  width: `${pct(c.to) - pct(c.from)}%`,
                }}
                disabled={!c.free}
                // No title: naming the box contradicts the pick tag once a drag resizes it.
                aria-label={`Reserve ${minutesToTime(c.from)} to ${minutesToTime(c.to)}`}
                onPointerDown={(e) => {
                  if (!c.free) return;
                  e.preventDefault(); // no text selection while dragging
                  beginDrag(i, e.clientX);
                }}
                // Keyboard only: detail 0 tells an assistive click from a released press.
                onClick={(e) => {
                  if (e.detail === 0) pickCell(i);
                }}
              />
            ))}
        </div>

        {tag && (
          <div ref={tagRef} className={tag.className} style={tag.style}>
            {minutesToTime(selFrom!)} - {minutesToTime(selTo!)}
          </div>
        )}
      </div>

      <div className="daycal-ticks">
        {tickLabels.map((t) => (
          <span key={t} className="daycal-tick" style={tickStyle(t)}>
            {minutesToTime(t)}
          </span>
        ))}
      </div>

      <div className="daycal-legend">
        <span>
          <i className="sw free" /> Free
        </span>
        <span>
          <i className="sw booked" /> Booked
        </span>
        <span>
          <i className="sw mine" /> Yours
        </span>
        <span>
          <i className="sw pick" /> Your pick
        </span>
      </div>

      {tip}

      {cancelOn && (
        <div
          className="modal-overlay"
          onClick={() => !cancelBusy && closeCancel()}
          role="presentation"
        >
          <div
            className="modal ask-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Cancel this reservation"
          >
            <button
              type="button"
              className="modal-close"
              onClick={closeCancel}
              disabled={cancelBusy}
              aria-label="Close"
            >
              ×
            </button>
            <h2>Cancel this reservation?</h2>
            <p className="modal-sub">
              <strong>{boothName}</strong>
              <br />
              {dateLabel}
              <br />
              {minutesToTime(cancelOn.fromMin)} -{" "}
              {minutesToTime(cancelOn.toMin)}
            </p>
            {cancelError && <p className="error">{cancelError}</p>}
            <div className="ask-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={closeCancel}
                disabled={cancelBusy}
              >
                Keep it
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={confirmCancel}
                disabled={cancelBusy}
              >
                {cancelBusy ? "Cancelling…" : "Yes, cancel it"}
              </button>
            </div>
          </div>
        </div>
      )}

      {askOn && contact && (
        <div
          className="modal-overlay"
          onClick={() => setAsking(null)}
          role="presentation"
        >
          <div
            className="modal ask-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Get in touch about this booking"
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setAsking(null)}
              aria-label="Close"
            >
              ×
            </button>
            <h2>Get in touch</h2>
            <p className="modal-sub">
              Choose how you&apos;d like to reach us about {boothName} on{" "}
              {dateLabel}, {minutesToTime(askOn.fromMin)} -{" "}
              {minutesToTime(askOn.toMin)}:
            </p>
            <div className="ask-actions">
              <a
                className="btn"
                href={mailtoLink(contact.email, askSubject, askMessage)}
                onClick={() => setAsking(null)}
              >
                <MailIcon /> Email
              </a>
              <a
                className="btn whatsapp"
                href={whatsappLink(contact.phone, askMessage)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setAsking(null)}
              >
                <WhatsAppIcon /> WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
