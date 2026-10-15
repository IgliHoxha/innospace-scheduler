import { verifyCancelToken, verifySeriesCancelToken } from "@/lib/auth";
import { getReservation, seriesReservations } from "@/lib/db";
import { boothName } from "@/lib/booths";
import { isActiveStatus } from "@/lib/types";
import { dateText, timeText } from "@/lib/templates";
import { nowDateTime } from "@/lib/datetime";
import CancelClient from "./CancelClient";

export const dynamic = "force-dynamic";

/** The emailed link lands here; its signed token is the only credential. */
export default async function CancelPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // A series link lists the dates still ahead; a passed date is not on offer.
  const seriesId = verifySeriesCancelToken(token);
  const ahead = seriesId
    ? seriesReservations(seriesId).filter(
        (r) => isActiveStatus(r.status) && (r.startsAt ?? "") >= nowDateTime(),
      )
    : [];

  const id = seriesId ? null : verifyCancelToken(token);
  const reservation = id ? getReservation(id) : null;

  const dead = seriesId ? false : !reservation;
  const alreadyGone = seriesId
    ? ahead.length === 0
    : !!reservation && !isActiveStatus(reservation.status);
  const first = seriesId ? ahead[0] : reservation;

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
            <p>
              {seriesId
                ? "Every date of this weekly reservation is already cancelled or has passed. Nothing to do."
                : "This reservation is already cancelled. Nothing to do."}
            </p>
            <a className="btn" href="/">
              Book a booth
            </a>
          </>
        ) : (
          <CancelClient
            token={token!}
            booth={boothName(first!.boothId)}
            date={dateText(first!)}
            time={timeText(first!)}
            dates={seriesId ? ahead.map(dateText) : undefined}
          />
        )}
      </div>
    </div>
  );
}
