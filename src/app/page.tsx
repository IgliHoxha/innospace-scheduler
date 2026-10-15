import { cookies } from "next/headers";
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
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { googleSignInEnabled } from "@/lib/google-auth";
import { MAX_REPEAT_WEEKS } from "@/lib/recurrence";
import ReservationClient from "./ReservationClient";

export const dynamic = "force-dynamic";

/** The booking screen: public, with an optional Google session for repeats. */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ signin?: string }>;
}) {
  const dates = reservableDates().map((value) => ({
    value,
    label: value === todayYMD() ? "Today" : formatDateMedium(value),
  }));

  const session = verifySessionToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  // The admin's session is not a booker's: it carries no verified email.
  const member =
    session?.role === "member" && session.email
      ? { name: session.name, email: session.email }
      : null;
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
      member={member}
      googleSignIn={googleSignInEnabled()}
      signInFailed={signin === "failed"}
      maxRepeatWeeks={MAX_REPEAT_WEEKS}
    />
  );
}
