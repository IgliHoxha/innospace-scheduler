import { verifyCancelToken } from "@/lib/auth";
import { getReservation } from "@/lib/db";
import { boothName } from "@/lib/booths";
import { ACTIVE_STATUSES } from "@/lib/types";
import { dateText, timeText } from "@/lib/templates";
import CancelClient from "./CancelClient";

export const dynamic = "force-dynamic";

/** Target of the emailed cancel link; the signed token is the only credential. */
export default async function CancelPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const id = verifyCancelToken(token);
  const reservation = id ? await getReservation(id) : null;

  const dead = !reservation;
  const alreadyGone =
    !!reservation &&
    !ACTIVE_STATUSES.includes(reservation.status as "confirmed" | "pending");

  return (
    <div className="login-wrap">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-logo" src="/logo.svg" alt="Innospace Tirana" />
        {dead ? (
          <>
            <p>
              This cancellation link is no longer valid. It may have expired
              with the reservation, or the booking is already gone.
            </p>
            <a className="btn" href="/">
              Book a booth
            </a>
          </>
        ) : alreadyGone ? (
          <>
            <p>This reservation is already cancelled. Nothing to do.</p>
            <a className="btn" href="/">
              Book a booth
            </a>
          </>
        ) : (
          <CancelClient
            token={token!}
            booth={boothName(reservation.boothId)}
            date={dateText(reservation)}
            time={timeText(reservation)}
          />
        )}
      </div>
    </div>
  );
}
