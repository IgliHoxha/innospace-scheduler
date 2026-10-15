"use client";

import { useState } from "react";

export default function CancelClient({
  token,
  booth,
  date,
  time,
  dates,
}: {
  token: string;
  booth: string;
  date: string;
  time: string;
  /** Every date still ahead of a weekly series; absent for a single booking. */
  dates?: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const series = !!dates && dates.length > 0;

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && json.ok) setDone(true);
      else setError(json.error || "Could not cancel that reservation.");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      // Always released, or a dropped connection leaves the button stuck.
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <p>
          {series
            ? "Every remaining date is cancelled. The slots are free for someone else now."
            : "Your reservation is cancelled. The slot is free for someone else now."}
        </p>
        <a className="btn" href="/">
          Book another
        </a>
      </>
    );
  }

  return (
    <>
      <p>
        {series
          ? `Cancel all ${dates.length} remaining dates of this weekly reservation?`
          : "Cancel this reservation?"}
        <br />
        <strong>{booth}</strong>
        <br />
        {series ? (
          <>
            {time}, every week
            <br />
            {dates.join(", ")}
          </>
        ) : (
          <>
            {date}
            <br />
            {time}
          </>
        )}
      </p>
      {error && <p className="error">{error}</p>}
      <button className="btn danger" onClick={cancel} disabled={busy}>
        {busy
          ? "Cancelling…"
          : series
            ? "Yes, cancel them all"
            : "Yes, cancel it"}
      </button>
      <a className="login-alt" href="/">
        {series ? "Keep them" : "Keep it"}
      </a>
    </>
  );
}
