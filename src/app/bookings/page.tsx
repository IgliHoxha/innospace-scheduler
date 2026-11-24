import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { loadMyBookings } from "@/lib/my-bookings-page";
import MyBookingsClient from "./MyBookingsClient";

export const dynamic = "force-dynamic";

/** A member's own bookings; it names them, so it is no-store in next.config, never edge-cached like "/". */
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = verifySessionToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  // Only a Google member has bookings of their own; anyone else books from "/".
  if (session?.role !== "member" || !session.email) redirect("/");

  const { page } = await searchParams;
  return (
    <MyBookingsClient
      name={session.name}
      email={session.email}
      initial={loadMyBookings(session.email, Number(page ?? "1"))}
    />
  );
}
