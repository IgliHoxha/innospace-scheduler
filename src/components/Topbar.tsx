import { UserMenu } from "@/components/UserMenu";

export function Topbar({
  username,
  brandHref = "/dashboard",
  brandLabel = "Scheduler dashboard",
}: {
  /** Omitted on the public booking screen, which has nobody signed in. */
  username?: string;
  brandHref?: string;
  brandLabel?: string;
}) {
  return (
    <div className="topbar">
      <div className="topbar-inner">
        <a className="brand" href={brandHref} aria-label={brandLabel}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="topbar-logo" src="/logo.svg" alt="Innospace Tirana" />
          <span className="brand-sub">Scheduler</span>
        </a>
        {username ? (
          <div className="topbar-right">
            <UserMenu username={username} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
