import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { getBooths } from "@/lib/booths";
import {
  reservableDates,
  autoApproveMaxHours,
  minReservationMinutes,
  stepMinutes,
} from "@/lib/schedule";
import { queryReservations } from "@/lib/db";
import { formatDateMedium, todayYMD } from "@/lib/datetime";
import ReservationClient from "./ReservationClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = verifySessionToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (!session) redirect("/login");
  // Admins manage from the dashboard; the reservation screen is for members.
  if (session.role === "admin") redirect("/dashboard");

  const dates = reservableDates().map((value) => ({
    value,
    label: value === todayYMD() ? "Today" : formatDateMedium(value),
  }));

  const myReservations = await queryReservations({
    filter: "all",
    userId: session.sub,
    pageSize: 100,
  });

  return (
    <ReservationClient
      booths={getBooths()}
      dates={dates}
      userName={session.name}
      initialMine={myReservations.reservations}
      autoApproveMaxHours={autoApproveMaxHours()}
      minReservationMinutes={minReservationMinutes()}
      stepMinutes={stepMinutes()}
    />
  );
}
