"use client";

import { useEffect, useRef, useState } from "react";
import { buildDaySegments } from "@/lib/timeline";

/** A reservation already taken for the booth+day, times as "HH:MM". */
interface Reserved {
  start: string;
  end: string;
  label: string;
  by: string | null;
  mine: boolean;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// A pick block narrower than this (px) can't hold its "HH:MM - HH:MM" tag, so the
// tag slides beside the block instead of centring inside it.
const TAG_FITS_PX = 96;

/**
 * Read-only availability graph for one booth+day: the open window drawn as a
 * horizontal bar, reservations as blocks (teal = yours, red = others), your
 * current pick highlighted. Purely a preview; the range is chosen in the fields
 * above, so this never handles clicks.
 */
export default function DayTimeline({
  opens,
  closes,
  earliest,
  reserved,
  selection,
}: {
  opens: string;
  closes: string;
  earliest: string;
  reserved: Reserved[];
  selection: { start: string; end: string } | null;
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

  const bookedMin = segments
    .filter((s) => s.reserved)
    .reduce((sum, s) => sum + (s.toMin - s.fromMin), 0);
  const freePct = Math.round(((span - bookedMin) / span) * 100);

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
        <span className="daycal-freepct">{freePct}% free</span>
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
                className={`daycal-block ${s.reserved.src.mine ? "mine" : ""}`}
                style={{
                  left: `${pct(s.fromMin)}%`,
                  width: `${pct(s.toMin) - pct(s.fromMin)}%`,
                }}
                title={`${toHHMM(s.fromMin)} - ${toHHMM(s.toMin)} · ${
                  s.reserved.src.mine ? "You" : s.reserved.src.by || "Reserved"
                }`}
              >
                <span className="daycal-block-label">
                  {s.reserved.src.mine
                    ? "You"
                    : s.reserved.src.by || "Reserved"}
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
          <i className="sw you" /> You
        </span>
        <span>
          <i className="sw pick" /> Your pick
        </span>
      </div>
    </div>
  );
}
