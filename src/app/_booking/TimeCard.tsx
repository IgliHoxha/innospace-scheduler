import type { ReactNode } from "react";

export function TimeCard({
  loading,
  loaded,
  empty,
  dayIsOver,
  onRetry,
  children,
}: {
  loading: boolean;
  /** False once a load failed, so the card offers a retry. */
  loaded: boolean;
  /** No free stretch left to seed the picker with. */
  empty: boolean;
  dayIsOver: boolean;
  onRetry: () => void;
  /** The picker and the day bar, shown only once a board has room. */
  children: ReactNode;
}) {
  return (
    <>
      <div className="field-label">Time</div>
      <div className="card time-card">
        {loading ? (
          <span className="muted">Loading availability…</span>
        ) : !loaded ? (
          <div className="load-failed">
            <span className="muted">Couldn&apos;t load availability.</span>
            <button type="button" className="btn ghost sm" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : empty ? (
          <div className="empty">
            {dayIsOver
              ? "There's no time left to reserve today. Pick another date."
              : "This booth is fully reserved on this day. Try another booth or date."}
          </div>
        ) : (
          children
        )}
      </div>
    </>
  );
}
