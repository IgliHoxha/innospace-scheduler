import { getBooths } from "@/lib/booths";
import {
  reservableDates,
  autoApproveMaxHours,
  minReservationMinutes,
  stepMinutes,
} from "@/lib/schedule";
import { formatDateMedium, todayYMD } from "@/lib/datetime";
import { turnstileSiteKey } from "@/lib/turnstile";
import ReservationClient from "./ReservationClient";

export const dynamic = "force-dynamic";

/** The booking screen: public, no account, no session to verify. */
export default async function Home() {
  const dates = reservableDates().map((value) => ({
    value,
    label: value === todayYMD() ? "Today" : formatDateMedium(value),
  }));

  return (
    <ReservationClient
      booths={getBooths()}
      dates={dates}
      autoApproveMaxHours={autoApproveMaxHours()}
      minReservationMinutes={minReservationMinutes()}
      stepMinutes={stepMinutes()}
      // Public by design, but read server-side so it never needs NEXT_PUBLIC_.
      turnstileSiteKey={turnstileSiteKey()}
    />
  );
}
