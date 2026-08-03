"use client";

import { useEffect, useRef, useState } from "react";
import { buildDaySegments } from "@/lib/timeline";

/** A reservation already taken for the booth+day, times as "HH:MM". */
interface Reserved {
  start: string;
  end: string;
  label: string;
  by: string | null;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// A pick block narrower than this (px) can't hold its "HH:MM - HH:MM" tag, so the
// tag slides beside the block instead of centring inside it.
const TAG_FITS_PX = 96;

/**
 * Availability graph for one booth+day. With `onPick` it also picks the range:
 * click an hour, or drag across several. Without it the graph is read-only, so
 * the same component still serves anywhere a plain preview is wanted.
 */
export default function DayTimeline({
  opens,
  closes,
  earliest,
  reserved,
  selection,
  onPick,
}: {
  opens: string;
  closes: string;
  earliest: string;
  reserved: Reserved[];
  selection: { start: string; end: string } | null;
  /** Called with "HH:MM" bounds as the pick changes. Omit for a read-only graph. */
  onPick?: (start: string, end: string) => void;
}) {
  const opensMin = toMin(opens);
  const closesMin = toMin(closes);
  const span = Math.max(1, closesMin - opensMin);
  const earliestMin = Math.max(opensMin, toMin(earliest));

  const pct = (min: number) =>
    Math.max(0, Math.min(100, ((min - opensMin) / span) * 100));

  const segments = buildDaySegments(
    opensMin,
    closesMin,
    reserved.map((r) => ({ start: toMin(r.start), end: toMin(r.end), src: r })),
  );

  const ticks: number[] = [];
  for (let h = Math.ceil(opensMin / 60) * 60; h <= closesMin; h += 60) {
    ticks.push(h);
  }
  // Edge ticks anchor to the bar's ends; inner ones centre on their mark.
  const tickStyle = (t: number) => {
    if (t <= opensMin) return { left: 0 };
    if (t >= closesMin) return { right: 0 };
    return { left: `${pct(t)}%`, transform: "translateX(-50%)" };
  };

  const selFrom = selection ? toMin(selection.start) : null;
  const selTo = selection ? toMin(selection.end) : null;
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

  // One box per hour. A box is pickable only if it is wholly free and not past,
  // so a click can never land on somebody else's booking.
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

  // The box the drag started on. Null when no drag is in progress. The ref is
  // what handlers read, so a drag started this render sees its own anchor.
  const [anchor, setAnchor] = useState<number | null>(null);
  const anchorRef = useRef<number | null>(null);
  anchorRef.current = anchor;

  /**
   * Pick from the anchor out towards `i`, stopping at the first taken box. The
   * span therefore always stays inside one free stretch, however far the pointer
   * travels, so a drag can never swallow a reservation in the middle.
   */
  const pickTo = (i: number, a = anchorRef.current) => {
    if (a == null || !onPick) return;
    let from = a;
    let to = a;
    for (let k = a; k >= Math.min(a, i) && cells[k].free; k--) from = k;
    for (let k = a; k <= Math.max(a, i) && cells[k].free; k++) to = k;
    onPick(toHHMM(cells[from].from), toHHMM(cells[to].to));
  };

  // The pointer is very often released outside the bar, so end the drag globally.
  useEffect(() => {
    if (anchor == null) return;
    const stop = () => setAnchor(null);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [anchor]);

  let tag: { className: string; style: React.CSSProperties } | null = null;
  if (hasPick) {
    const pickPx = (barPx * (selTo! - selFrom!)) / span;
    const center = (pct(selFrom!) + pct(selTo!)) / 2;
    if (barPx === 0 || pickPx >= TAG_FITS_PX) {
      // Roomy pick: centre the tag inside it.
      tag = {
        className: "daycal-pick-tag over",
        style: { left: `${center}%`, transform: "translate(-50%, -50%)" },
      };
    } else if (center <= 12) {
      // Too tight and hugging the left edge: anchor the floating tag there.
      tag = { className: "daycal-pick-tag above start", style: { left: 0 } };
    } else if (center >= 88) {
      tag = { className: "daycal-pick-tag above end", style: { right: 0 } };
    } else {
      // Too tight: float the tag above the pick so it never lands on a neighbour.
      tag = {
        className: "daycal-pick-tag above",
        style: { left: `${center}%`, transform: "translateX(-50%)" },
      };
    }
  }

  return (
    <div className="daycal">
      <div className="daycal-head">
        <span className="daycal-title">Availability</span>
      </div>

      <div
        className={`daycal-plot ${tag?.className.includes("above") ? "has-toptag" : ""}`}
      >
        <div className="daycal-bar" ref={barRef}>
          {ticks
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
              title="Already passed"
            />
          )}

          {segments.map((s, i) =>
            s.reserved ? (
              <div
                key={i}
                className="daycal-block"
                style={{
                  left: `${pct(s.fromMin)}%`,
                  width: `${pct(s.toMin) - pct(s.fromMin)}%`,
                }}
                title={`${toHHMM(s.fromMin)} - ${toHHMM(s.toMin)} · ${
                  s.reserved.src.by || "Reserved"
                }`}
              >
                <span className="daycal-block-label">
                  {s.reserved.src.by || "Reserved"}
                </span>
              </div>
            ) : null,
          )}

          {hasPick && (
            <div
              className="daycal-pick"
              style={{
                left: `${pct(selFrom!)}%`,
                width: `${pct(selTo!) - pct(selFrom!)}%`,
              }}
            />
          )}

          {/* Sits above everything so it can take the pointer. Taken hours opt
              out of pointer events entirely, so their tooltips still work. */}
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
                aria-label={`Reserve ${toHHMM(c.from)} to ${toHHMM(c.to)}`}
                title={`${toHHMM(c.from)} - ${toHHMM(c.to)}`}
                onPointerDown={(e) => {
                  if (!c.free) return;
                  e.preventDefault(); // no text selection while dragging
                  setAnchor(i);
                  pickTo(i, i);
                }}
                onPointerEnter={() => {
                  if (anchorRef.current != null) pickTo(i);
                }}
                // Keyboard and assistive tech never send pointer events.
                onClick={() => pickTo(i, i)}
              />
            ))}
        </div>

        {tag && (
          <div className={tag.className} style={tag.style}>
            {toHHMM(selFrom!)} - {toHHMM(selTo!)}
          </div>
        )}
      </div>

      <div className="daycal-ticks">
        {ticks.map((t) => (
          <span key={t} className="daycal-tick" style={tickStyle(t)}>
            {toHHMM(t)}
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
          <i className="sw pick" /> Your pick
        </span>
      </div>
    </div>
  );
}
