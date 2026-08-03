"use client";

import { useState } from "react";

/** Confirm step for the emailed cancel link: shows what's being cancelled first. */
export default function CancelClient({
  token,
  booth,
  date,
  time,
}: {
  token: string;
  booth: string;
  date: string;
  time: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function cancel() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    setBusy(false);
    if (res.ok && json.ok) setDone(true);
    else setError(json.error || "Could not cancel that reservation.");
  }

  if (done) {
    return (
      <>
        <p>
          Your reservation is cancelled. The slot is free for someone else now.
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
        Cancel this reservation?
        <br />
        <strong>{booth}</strong>
        <br />
        {date}
        <br />
        {time}
      </p>
      {error && <p className="error">{error}</p>}
      <button className="btn danger" onClick={cancel} disabled={busy}>
        {busy ? "Cancelling…" : "Yes, cancel it"}
      </button>
      <a className="login-alt" href="/">
        Keep it
      </a>
    </>
  );
}
