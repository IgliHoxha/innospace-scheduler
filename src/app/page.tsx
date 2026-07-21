import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { getBooths } from "@/lib/booths";
import {
  bookableDates,
  todayYMD,
  autoApproveMaxHours,
  minBookingMinutes,
} from "@/lib/schedule";
import { queryReservations } from "@/lib/db";
import { formatDateMedium } from "@/lib/date-format";
import BookingClient from "./BookingClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = verifySessionToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (!session) redirect("/login");
  // Admins manage from the dashboard; the booking screen is for members.
  if (session.role === "admin") redirect("/dashboard");

  const dates = bookableDates().map((value) => ({
    value,
    label: value === todayYMD() ? "Today" : formatDateMedium(value),
  }));

  const myBookings = await queryReservations({
    filter: "all",
    userId: session.sub,
    pageSize: 100,
  });

  return (
    <BookingClient
      booths={getBooths()}
      dates={dates}
      userName={session.name}
      initialMine={myBookings.reservations}
      autoApproveMaxHours={autoApproveMaxHours()}
      minBookingMinutes={minBookingMinutes()}
    />
  );
}
