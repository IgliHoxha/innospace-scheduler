import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { queryReservations } from "@/lib/db";
import { getContactFromEnv } from "@/lib/email";
import DashboardClient from "./DashboardClient";
import { PAGE_SIZE, INITIAL_FILTER } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = verifySessionToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (!session) redirect("/login");
  // Members don't get the dashboard: send them to the booking screen.
  if (session.role !== "admin") redirect("/");

  const initialData = await queryReservations({
    filter: INITIAL_FILTER,
    page: 1,
    pageSize: PAGE_SIZE,
  });

  return (
    <DashboardClient
      initialData={initialData}
      username={session.name}
      contact={getContactFromEnv()}
    />
  );
}
