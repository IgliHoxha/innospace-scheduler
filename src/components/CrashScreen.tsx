"use client";

/** What a page shows when its own code failed, in place of Next's bare white screen. */
export function CrashScreen({
  // A full reload, not a re-render: whatever broke the page may have left its markup broken too.
  onReload = () => window.location.reload(),
}: {
  onReload?: () => void;
}) {
  return (
    <div className="login-wrap">
      <div className="login-card" role="alert">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-logo" src="/logo.svg" alt="Innospace Tirana" />
        <p>
          <strong>Something went wrong.</strong>
          <br />
          This page ran into a problem. Reload it to carry on. If you were in
          the middle of booking, check your email for a confirmation before you
          try again.
        </p>
        <button type="button" className="btn" onClick={onReload}>
          Reload
        </button>
      </div>
    </div>
  );
}
