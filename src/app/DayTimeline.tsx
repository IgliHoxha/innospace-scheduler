"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  barEndPercent,
  barPercent,
  buildDaySegments,
  dragRange,
  fittingTicks,
  hourCells,
  pickTagPlacement,
  roomFor,
} from "@/lib/timeline";
import { minutesToTime, timeToMinutes } from "@/lib/datetime";
import { dayEndMinute } from "@/lib/reservation-rules";
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
  /** The proof needed to cancel; only on a booking this browser made. */
  cancelToken?: string;
}

// A pick narrower than this (px) cannot hold its tag, so it floats.
const TAG_FITS_PX = 96;

// Space (px) a tag keeps inside its pick, so enlarged text floats it sooner.
const TAG_MARGIN_PX = 24;

// Travel (px) before a press is a drag; below it, it stays a click.
const DRAG_SLOP_PX = 4;

// Room (px) a tick needs clear of its neighbour, so a narrow bar shows fewer.
const TICK_LABEL_PX = 48;

// Clear space (px) between two marks, on top of their measured widths.
const TICK_GAP_PX = 7;

export default function DayTimeline({
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
  earliest: string;
  reserved: Reserved[];
  selection: { start: string; end: string } | null;
  /** Gets "HH:MM" bounds as the pick changes; omit for a read-only graph. */
  onPick?: (start: string, end: string) => void;
  /** The minute grid a drag snaps to; a click takes the whole hour. */
  step: number;
  /** Shortest booking, so a drag can't return a range the form rejects. */
  minMinutes: number;
  /** Enquiries about a taken slot go here; omitted, taken blocks stay inert. */
  contact?: { phone: string; email: string };
  onCancelled?: () => void;
  boothName?: string;
  dateLabel?: string;
}) {
  // A pick stops a step short of the bar's 24 hours: "24:00" is not a time.
  const dayStartMin = 0;
  const dayEndMin = 24 * 60;
  const lastEndMin = dayEndMinute(step);
  const span = Math.max(1, dayEndMin - dayStartMin);
  const earliestMin = Math.max(dayStartMin, timeToMinutes(earliest));

  const pct = (min: number) => barPercent(min, dayStartMin, dayEndMin);
  // A booking or pick ending on the last step is drawn out to the bar's end.
  const pctEnd = (min: number) =>
    barEndPercent(min, dayStartMin, dayEndMin, lastEndMin);

  const segments = buildDaySegments(
    dayStartMin,
    dayEndMin,
    reserved.map((r) => ({
      start: timeToMinutes(r.start),
      end: timeToMinutes(r.end),
      src: r,
    })),
  );

  const hourMarks: number[] = [];
  for (let h = Math.ceil(dayStartMin / 60) * 60; h <= dayEndMin; h += 60) {
    hourMarks.push(h);
  }
  const tickStyle = (t: number) => {
    if (t <= dayStartMin) return { left: 0 };
    if (t >= dayEndMin) return { right: 0 };
    return { left: `${pct(t)}%`, transform: "translateX(-50%)" };
  };

  const selFrom = selection ? timeToMinutes(selection.start) : null;
  const selTo = selection ? timeToMinutes(selection.end) : null;
  const hasPick =
    selFrom != null &&
    selTo != null &&
    selTo > dayStartMin &&
    selFrom < dayEndMin;

  // Measure the bar so a narrow pick can move its time tag outside the block.
  const barRef = useRef<HTMLDivElement>(null);
  const [barPx, setBarPx] = useState(0);
  // One hour mark as it renders, so enlarged text thins the marks.
  const tickRef = useRef<HTMLDivElement>(null);
  const [tickPx, setTickPx] = useState(0);
  useEffect(() => {
    const bar = barRef.current;
    const tick = tickRef.current;
    if (!bar || !tick) return;
    const update = () => {
      setBarPx(bar.clientWidth);
      setTickPx(tick.offsetWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(bar);
    ro.observe(tick);
    return () => ro.disconnect();
  }, []);

  // A narrow bar labels fewer marks, though the grid still runs hourly.
  const tickLabels = fittingTicks(
    dayStartMin,
    dayEndMin,
    barPx,
    tickPx,
    TICK_LABEL_PX,
    TICK_GAP_PX,
  );

  // The tag's width, so a floating tag centres on its pick inside the bar.
  const [tagPx, setTagPx] = useState(0);
  // Its text alone: the same inside or floating, so the choice cannot flip.
  const [tagTextPx, setTagTextPx] = useState(0);
  const tagRo = useRef<ResizeObserver | null>(null);
  // Callback ref: the tag mounts with the pick and its width tracks its class.
  const tagRef = useCallback((el: HTMLDivElement | null) => {
    tagRo.current?.disconnect();
    if (!el) return;
    const update = () => {
      setTagPx(el.offsetWidth);
      setTagTextPx(
        (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0,
      );
    };
    update();
    tagRo.current = new ResizeObserver(update);
    // The border box: floating adds padding, which the content box never sees.
    tagRo.current.observe(el, { box: "border-box" });
  }, []);

  // One box per hour, pickable only if wholly free and not past.
  const cells = hourCells(
    segments,
    earliestMin,
    dayStartMin,
    dayEndMin,
    lastEndMin,
    minMinutes,
  );

  // The gesture in flight, in a ref so the window listeners read live values.
  const dragRef = useRef<{
    anchorMin: number;
    startX: number;
    cell: number;
    stretch: { from: number; to: number };
  } | null>(null);
  // Set once a press has travelled far enough to be a drag, not a click.
  const movedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  /** The minute under the pointer, measured on the bar rather than on a box. */
  const minuteAt = (clientX: number): number => {
    const el = barRef.current;
    if (!el) return dayStartMin;
    const r = el.getBoundingClientRect();
    return dayStartMin + ((clientX - r.left) / Math.max(1, r.width)) * span;
  };

  /** The free run of the day this hour box sits in, floored at "now". */
  const stretchFor = (i: number): { from: number; to: number } | null => {
    const c = cells[i];
    const s = segments.find(
      (g) => !g.reserved && g.fromMin < c.to && g.toMin > c.from,
    );
    if (!s) return null;
    return {
      from: Math.max(s.fromMin, earliestMin),
      to: Math.min(s.toMin, lastEndMin),
    };
  };

  const pickCell = (i: number) => {
    if (onPick && cells[i].free) {
      onPick(minutesToTime(cells[i].from), minutesToTime(cells[i].end));
    }
  };

  // Rebound each render, so listeners see this render's segments and size.
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

  // Keyed on the range, so the popover closes itself if the booking is gone.
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

  // Keyed on the range too, so a cancellation takes its dialog with it.
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

  /** The emailed link's endpoint, with the token kept at booking. */
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

  /** Track the gesture on the window, so no movement slips through a render. */
  const beginDrag = (i: number, clientX: number) => {
    const stretch = stretchFor(i);
    if (!stretch) return;
    // The box pressed, not the pixel: a drag and a click start alike.
    const anchorMin = Math.max(cells[i].from, stretch.from);
    movedRef.current = false;
    dragRef.current = {
      anchorMin,
      startX: clientX,
      cell: i,
      stretch,
    };

    const move = (e: PointerEvent) => onMoveRef.current(e.clientX);
    // A press that never travelled is a click, proven on release.
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

  let tag: {
    above: boolean;
    className: string;
    style: React.CSSProperties;
  } | null = null;
  if (hasPick) {
    const place = pickTagPlacement({
      barPx,
      tagPx,
      fromPct: pct(selFrom!),
      toPct: pctEnd(selTo!),
      fitsPx: roomFor(tagTextPx, TAG_FITS_PX, 1, TAG_MARGIN_PX),
    });
    tag = {
      above: place.above,
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

      <div className="daycal-plot">
        {/* An unseen line of the tag, so the strip above grows with it. */}
        {tag?.above && (
          <div
            className="daycal-pick-tag above daycal-sizer"
            aria-hidden="true"
          >
            <span>{"\u200b"}</span>
          </div>
        )}
        <div
          className={`daycal-bar ${dragging ? "dragging" : ""}`}
          ref={barRef}
        >
          {/* In the label's own class, so the bar grows with enlarged text. */}
          <span className="daycal-block-label daycal-sizer" aria-hidden="true">
            {"\u200b"}
          </span>
          {/* A tag sitting inside its pick must fit the bar too. */}
          <div className="daycal-pick-tag daycal-sizer" aria-hidden="true">
            <span>{"\u200b"}</span>
          </div>
          {hourMarks
            .filter((t) => t > dayStartMin && t < dayEndMin)
            .map((t) => (
              <div
                key={`g${t}`}
                className="daycal-grid"
                style={{ left: `${pct(t)}%` }}
              />
            ))}

          {earliestMin > dayStartMin && (
            <div
              className="daycal-past"
              style={{ left: 0, width: `${pct(earliestMin)}%` }}
              {...tooltip("Already passed")}
            />
          )}

          {segments.map((s, i) => {
            if (!s.reserved) return null;
            const src = s.reserved.src;
            const canCancel = !!src.cancelToken;
            const range = { from: s.fromMin, to: s.toMin };
            // Segments are consecutive, so a booked next one means these touch.
            const seam = !!segments[i + 1]?.reserved;
            return (
              <button
                key={`${s.fromMin}-${s.toMin}`}
                type="button"
                className={`daycal-block ${src.mine ? "mine" : ""} ${canCancel ? "can-cancel" : ""} ${seam ? "seam" : ""}`}
                style={{
                  left: `${pct(s.fromMin)}%`,
                  width: `${pctEnd(s.toMin) - pct(s.fromMin)}%`,
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
              // At the bar's end the border follows the curve, or it is sliced.
              className={`daycal-pick ${pct(selFrom!) === 0 ? "at-start" : ""} ${
                pctEnd(selTo!) === 100 ? "at-end" : ""
              }`}
              style={{
                left: `${pct(selFrom!)}%`,
                width: `${pctEnd(selTo!) - pct(selFrom!)}%`,
              }}
            />
          )}

          {/* On top to take the pointer; taken hours opt out for tooltips. */}
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
                // No title: it would contradict the pick tag as a drag resizes.
                aria-label={`Reserve ${minutesToTime(c.from)} to ${minutesToTime(c.end)}`}
                onPointerDown={(e) => {
                  if (!c.free) return;
                  e.preventDefault(); // no text selection while dragging
                  beginDrag(i, e.clientX);
                }}
                // Keyboard only: detail 0 tells assistive clicks from presses.
                onClick={(e) => {
                  if (e.detail === 0) pickCell(i);
                }}
              />
            ))}
        </div>

        {tag && (
          <div ref={tagRef} className={tag.className} style={tag.style}>
            <span>
              {minutesToTime(selFrom!)} - {minutesToTime(selTo!)}
            </span>
          </div>
        )}
      </div>

      <div className="daycal-ticks">
        {/* Unseen, in flow: the strip's height and the width to thin by. */}
        <div ref={tickRef} className="daycal-tick-sizer" aria-hidden="true">
          {hourMarks.map((t) => (
            <span key={t} className="daycal-tick">
              {minutesToTime(t)}
            </span>
          ))}
        </div>
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
