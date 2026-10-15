import { NextRequest, NextResponse } from "next/server";
import {
  cancelSeriesFrom,
  getReservation,
  updateReservationStatus,
} from "@/lib/db";
import { verifyCancelToken, verifySeriesCancelToken } from "@/lib/auth";
import { jsonBody } from "@/lib/api-request";
import { jsonError } from "@/lib/api-response";
import { requireAllowedOrigin } from "@/lib/cors";
import { isActiveStatus } from "@/lib/types";
import { boothName } from "@/lib/booths";
import { nowDateTime } from "@/lib/datetime";
import { postReservationToSlack } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancel from the emailed link; the token names one slot, or one series, and dies with it. */
export async function POST(req: NextRequest) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const { token } = await jsonBody(req);
  const raw = typeof token === "string" ? token : undefined;

  const seriesId = verifySeriesCancelToken(raw);
  if (seriesId) {
    // Dates already under way stay: the person is in the booth.
    const cancelled = cancelSeriesFrom(seriesId, nowDateTime());
    for (const r of cancelled) {
      await postReservationToSlack(r, "cancelled", boothName, "guest");
    }
    return NextResponse.json({
      ok: true,
      alreadyCancelled: cancelled.length === 0,
      cancelled: cancelled.length,
    });
  }

  const id = verifyCancelToken(raw);
  if (!id) {
    return jsonError("This cancellation link is no longer valid.", 400);
  }

  const existing = getReservation(id);
  if (!existing) {
    return jsonError("That reservation no longer exists.", 404);
  }

  // Already cancelled: success, so a double-click reads as done, not an error.
  if (!isActiveStatus(existing.status)) {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  const reservation = updateReservationStatus(id, "cancelled");
  if (!reservation) {
    return jsonError("That reservation no longer exists.", 404);
  }

  // The channel still hears it: the slot is free again.
  await postReservationToSlack(reservation, "cancelled", boothName, "guest");

  // No email: their own action, and the template is for an admin cancelling.
  return NextResponse.json({ ok: true, alreadyCancelled: false });
}
