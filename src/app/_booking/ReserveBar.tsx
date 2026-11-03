import { repeatLabel } from "@/lib/recurrence";

export function ReserveBar({
  summary,
  repeatWeeks,
  needsApproval,
  canReserve,
  busy,
  onReserve,
}: {
  /** Booth, day and range, or null while there is no bookable pick. */
  summary: { booth?: string; day?: string; start: string; end: string } | null;
  repeatWeeks: number;
  needsApproval: boolean;
  canReserve: boolean;
  busy: boolean;
  onReserve: () => void;
}) {
  return (
    <div className="reserve-bar">
      <div className="reserve-summary">
        {summary ? (
          <>
            <strong>{summary.booth}</strong> · {summary.day} · {summary.start} -{" "}
            {summary.end}
            {repeatWeeks > 1 && (
              <span className="hint"> · {repeatLabel(repeatWeeks)}</span>
            )}
            {needsApproval && (
              <span className="hint"> · needs admin approval</span>
            )}
          </>
        ) : (
          <span className="muted">Pick a start and end time to reserve.</span>
        )}
      </div>
      <button className="btn" disabled={!canReserve} onClick={onReserve}>
        {busy ? "Reservation…" : "Reserve"}
      </button>
    </div>
  );
}
