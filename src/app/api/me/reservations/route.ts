import { NextRequest, NextResponse } from "next/server";
import { memberFrom } from "@/lib/api-auth";
import { jsonError } from "@/lib/api-response";
import { loadMyBookings } from "@/lib/my-bookings-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** One page of a member's own bookings, for the /bookings page to turn through. */
export async function GET(req: NextRequest) {
  const member = memberFrom(req);
  if (!member) return jsonError("Please sign in first.", 401, NO_STORE);

  const page = Number(req.nextUrl.searchParams.get("page") ?? "1");
  return NextResponse.json(
    { ok: true, ...loadMyBookings(member.email, page) },
    { headers: NO_STORE },
  );
}
