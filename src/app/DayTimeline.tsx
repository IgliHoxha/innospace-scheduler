"use client";

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

  return (
    <div className="daycal">
      <div className="daycal-head">
        <span className="daycal-title">Availability</span>
        <span className="daycal-freepct">{freePct}% free</span>
      </div>

      <div className="daycal-bar">
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
                {s.reserved.src.mine ? "You" : s.reserved.src.by || "Reserved"}
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
            title={`Your pick ${toHHMM(selFrom!)} - ${toHHMM(selTo!)}`}
          >
            <span>
              {toHHMM(selFrom!)} - {toHHMM(selTo!)}
            </span>
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
