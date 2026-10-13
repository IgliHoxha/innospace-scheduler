import { NextRequest, NextResponse } from "next/server";
import { changeReservationStatus } from "@/lib/reservation-actions";
import { requireAdmin } from "@/lib/api-auth";
import { jsonBody } from "@/lib/api-request";
import { jsonError } from "@/lib/api-response";
import { requireAllowedOrigin } from "@/lib/cors";
import { isReservationStatus, MAX_EMAIL_BODY } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only approve, cancel or delete; the booker uses their emailed link. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;
  const { status, emailBody } = await jsonBody(req);

  if (!isReservationStatus(status)) {
    return jsonError("Invalid status.", 400);
  }
  if (typeof emailBody === "string" && emailBody.length > MAX_EMAIL_BODY) {
    return jsonError("That email body is too long.", 400);
  }

  // Emails the booker and tells Slack; neither failing fails the change.
  const changed = await changeReservationStatus(
    id,
    status,
    typeof emailBody === "string" ? emailBody : undefined,
  );
  if (!changed) {
    return jsonError("Not found.", 404);
  }

  return NextResponse.json({ ok: true, reservation: changed.reservation });
}
