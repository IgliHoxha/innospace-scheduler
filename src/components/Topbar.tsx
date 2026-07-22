import type { ReactNode } from "react";
import { UserMenu } from "@/components/UserMenu";

/** Signed-in app header: brand, optional right-side nav links, and the user menu. */
export function Topbar({
  username,
  brandHref = "/dashboard",
  brandLabel = "Scheduler dashboard",
  nav,
}: {
  username: string;
  brandHref?: string;
  brandLabel?: string;
  /** Right-side nav links rendered before the user menu; omitted on the member screen. */
  nav?: ReactNode;
}) {
  return (
    <div className="topbar">
      <div className="topbar-inner">
        <a className="brand" href={brandHref} aria-label={brandLabel}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="topbar-logo" src="/logo.svg" alt="Innospace Tirana" />
          <span className="brand-sub">Scheduler</span>
        </a>
        {nav ? (
          <div className="topbar-right">
            {nav}
            <UserMenu username={username} />
          </div>
        ) : (
          <UserMenu username={username} />
        )}
      </div>
    </div>
  );
}
