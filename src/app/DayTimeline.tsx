"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  barEndPercent,
  barPercent,
  buildDaySegments,
  dragRange,
  fittingTicks,
  freeStretchFor,
  hourCells,
  hourMarkMinutes,
  pickTagPlacement,
  roomFor,
} from "@/lib/timeline";
import { minutesToTime, timeToMinutes } from "@/lib/datetime";
import { dayEndMinute } from "@/lib/reservation-rules";
import type { ReservedSlot } from "@/lib/mine";
import { TrashIcon } from "@/components/ui/icons";
import { useTooltip } from "@/components/ui/tooltip";
import { AskDialog, CancelDialog } from "./DayTimelineDialogs";

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
  reserved: ReservedSlot[];
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

  const hourMarks = hourMarkMinutes(dayStartMin, dayEndMin);
  const tickStyle = (t: number) => {
    if (t <= dayStartMin) return { left: 0 };
    if (t >= dayEndMin) return { right: 0 };
    return { left: `${pct(t)}%`, transform: "translateX(-50%)" };
  };

  const selFrom = selection ? timeToMinutes(selection.start) : null;
  const selTo = selection ? timeToMinutes(selection.end) : null;
  const pick =
    selFrom != null &&
    selTo != null &&
    selTo > dayStartMin &&
    selFrom < dayEndMin
      ? {
          fromMin: selFrom,
          toMin: selTo,
          fromPct: pct(selFrom),
          toPct: pctEnd(selTo),
        }
      : null;

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

  // Read off this render's board, so a dialog goes when its booking does.
  const bookedAt = (r: { from: number; to: number } | null) =>
    (r &&
      segments.find(
        (s) => s.reserved && s.fromMin === r.from && s.toMin === r.to,
      )) ||
    null;

  // Keyed on the range, so the popover closes itself if the booking is gone.
  const [asking, setAsking] = useState<{ from: number; to: number } | null>(
    null,
  );
  const askOn = bookedAt(asking);

  // Keyed on the range too, so a cancellation takes its dialog with it.
  const [cancelling, setCancelling] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const cancelOn = bookedAt(cancelling);
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
    const stretch = freeStretchFor(segments, cells[i], earliestMin, lastEndMin);
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
    from: string;
    to: string;
  } | null = null;
  if (pick) {
    const place = pickTagPlacement({
      barPx,
      tagPx,
      fromPct: pick.fromPct,
      toPct: pick.toPct,
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
      from: minutesToTime(pick.fromMin),
      to: minutesToTime(pick.toMin),
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
            const when = `${minutesToTime(s.fromMin)} - ${minutesToTime(s.toMin)}`;
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
                    ? `Your booking, ${when} · click to cancel it`
                    : src.mine
                      ? `Your booking, ${when}${contact ? " · click to contact us about it" : ""}`
                      : `${when} · Booked${contact ? " - click to request information" : ""}`,
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

          {pick && (
            <div
              // At the bar's end the border follows the curve, or it is sliced.
              className={`daycal-pick ${pick.fromPct === 0 ? "at-start" : ""} ${
                pick.toPct === 100 ? "at-end" : ""
              }`}
              style={{
                left: `${pick.fromPct}%`,
                width: `${pick.toPct - pick.fromPct}%`,
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
              {tag.from} - {tag.to}
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
        <CancelDialog
          boothName={boothName}
          dateLabel={dateLabel}
          from={minutesToTime(cancelOn.fromMin)}
          to={minutesToTime(cancelOn.toMin)}
          busy={cancelBusy}
          error={cancelError}
          onClose={closeCancel}
          onConfirm={confirmCancel}
        />
      )}

      {askOn && contact && (
        <AskDialog
          boothName={boothName}
          dateLabel={dateLabel}
          from={minutesToTime(askOn.fromMin)}
          to={minutesToTime(askOn.toMin)}
          contact={contact}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}
