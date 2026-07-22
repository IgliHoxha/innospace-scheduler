"use client";

import { buildDaySegments, snapToStep, suggestedEndMin } from "@/lib/timeline";

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

// Vertical scale. 30 minutes = 42px, tall enough for a short label on the block.
const PX_PER_MIN = 1.4;
const PREFERRED_MIN = 60; // default length when you click an open stretch

/**
 * Day view of one booth's availability (Google Calendar style): reservations as
 * blocks, open stretches clickable to pick a start. Purely presentational over
 * the availability the parent already loaded; picking flows back through onPick.
 */
export default function DayTimeline({
  opens,
  closes,
  earliest,
  reserved,
  selection,
  stepMinutes,
  minReservationMinutes,
  onPick,
}: {
  opens: string;
  closes: string;
  earliest: string;
  reserved: Reserved[];
  selection: { start: string; end: string } | null;
  stepMinutes: number;
  minReservationMinutes: number;
  onPick: (start: string, end: string) => void;
}) {
  const opensMin = toMin(opens);
  const closesMin = toMin(closes);
  const earliestMin = Math.max(opensMin, toMin(earliest));
  const height = (closesMin - opensMin) * PX_PER_MIN;
  const top = (min: number) => (min - opensMin) * PX_PER_MIN;

  const segments = buildDaySegments(
    opensMin,
    closesMin,
    reserved.map((r) => ({ start: toMin(r.start), end: toMin(r.end), src: r })),
  );

  const hours: number[] = [];
  for (let h = Math.ceil(opensMin / 60) * 60; h <= closesMin; h += 60) {
    hours.push(h);
  }

  function pick(rawMin: number, segFrom: number, segTo: number) {
    const lo = Math.max(segFrom, earliestMin);
    let startMin = snapToStep(rawMin, stepMinutes);
    startMin = Math.min(Math.max(startMin, lo), segTo - minReservationMinutes);
    const endMin = suggestedEndMin(
      startMin,
      segTo,
      minReservationMinutes,
      PREFERRED_MIN,
    );
    if (endMin != null) onPick(toHHMM(startMin), toHHMM(endMin));
  }

  const bookable = (segFrom: number, segTo: number) =>
    segTo - Math.max(segFrom, earliestMin) >= minReservationMinutes;

  const selFrom = selection ? toMin(selection.start) : null;
  const selTo = selection ? toMin(selection.end) : null;

  return (
    <div className="daycal">
      <div className="daycal-axis" style={{ height }}>
        {hours.map((h) => (
          <span key={h} className="daycal-tick" style={{ top: top(h) }}>
            {toHHMM(h)}
          </span>
        ))}
      </div>
      <div className="daycal-track" style={{ height }}>
        {hours.map((h) => (
          <div key={h} className="daycal-line" style={{ top: top(h) }} />
        ))}

        {earliestMin > opensMin && (
          <div
            className="daycal-past"
            style={{ height: (earliestMin - opensMin) * PX_PER_MIN }}
          />
        )}

        {segments.map((s, i) => {
          const blockTop = top(s.fromMin);
          const blockH = (s.toMin - s.fromMin) * PX_PER_MIN;
          if (s.reserved) {
            const r = s.reserved.src;
            return (
              <div
                key={i}
                className={`daycal-event ${r.mine ? "mine" : ""}`}
                style={{ top: blockTop, height: blockH }}
              >
                <span className="daycal-event-time">
                  {toHHMM(s.fromMin)} - {toHHMM(s.toMin)}
                </span>
                <span className="daycal-event-who">
                  {r.mine ? "You" : r.by || "Reserved"}
                </span>
              </div>
            );
          }
          if (!bookable(s.fromMin, s.toMin)) return null;
          return (
            <div
              key={i}
              className="daycal-free"
              style={{ top: blockTop, height: blockH }}
              role="button"
              tabIndex={0}
              aria-label={`Reserve from ${toHHMM(Math.max(s.fromMin, earliestMin))}`}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                pick(
                  s.fromMin + (e.clientY - rect.top) / PX_PER_MIN,
                  s.fromMin,
                  s.toMin,
                );
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(s.fromMin, s.fromMin, s.toMin);
                }
              }}
            >
              <span className="daycal-free-hint">Free - click to reserve</span>
            </div>
          );
        })}

        {selFrom != null &&
          selTo != null &&
          selTo > opensMin &&
          selFrom < closesMin && (
            <div
              className="daycal-selection"
              style={{
                top: top(Math.max(selFrom, opensMin)),
                height:
                  (Math.min(selTo, closesMin) - Math.max(selFrom, opensMin)) *
                  PX_PER_MIN,
              }}
            >
              <span>
                {toHHMM(selFrom)} - {toHHMM(selTo)}
              </span>
            </div>
          )}
      </div>
    </div>
  );
}
