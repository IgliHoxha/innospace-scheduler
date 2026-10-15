import { UserMenu } from "@/components/UserMenu";

export function Topbar({
  username,
  email,
  signOutTo,
  brandHref = "/dashboard",
  brandLabel = "Scheduler dashboard",
}: {
  /** Omitted on the public booking screen while nobody is signed in. */
  username?: string;
  /** A Google member's address, shown in the menu under their name. */
  email?: string;
  /** Where sign-out lands; the admin's login unless told otherwise. */
  signOutTo?: string;
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
            <UserMenu username={username} email={email} signOutTo={signOutTo} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
