import { getBooths } from "@/lib/booths";
import {
  reservableDates,
  autoApproveMaxHours,
  minReservationMinutes,
  stepMinutes,
} from "@/lib/schedule";
import { formatDateMedium, todayYMD } from "@/lib/datetime";
import { turnstileSiteKey } from "@/lib/turnstile";
import { getContactFromEnv } from "@/lib/env-app";
import { googleSignInEnabled } from "@/lib/google-auth";
import { MAX_REPEAT_WEEKS } from "@/lib/recurrence";
import ReservationClient from "./ReservationClient";

export const dynamic = "force-dynamic";

/** The booking screen: edge-cached, so it never reads the session; the form asks /api/me. */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ signin?: string }>;
}) {
  const dates = reservableDates().map((value) => ({
    value,
    label: value === todayYMD() ? "Today" : formatDateMedium(value),
  }));
  const { signin } = await searchParams;

  return (
    <ReservationClient
      booths={getBooths()}
      dates={dates}
      autoApproveMaxHours={autoApproveMaxHours()}
      minReservationMinutes={minReservationMinutes()}
      stepMinutes={stepMinutes()}
      contact={getContactFromEnv()}
      // Public by design, but read server-side so it never needs NEXT_PUBLIC_.
      turnstileSiteKey={turnstileSiteKey()}
      googleSignIn={googleSignInEnabled()}
      signInFailed={signin === "failed"}
      maxRepeatWeeks={MAX_REPEAT_WEEKS}
    />
  );
}
