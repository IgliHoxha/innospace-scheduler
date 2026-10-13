import { NextRequest, NextResponse } from "next/server";
import { jsonBody } from "@/lib/api-request";
import { jsonError } from "@/lib/api-response";
import { handleTelegramUpdate, isTelegramWebhook } from "@/lib/telegram-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Telegram posts each message to the bot here; the secret header is the only proof. */
export async function POST(req: NextRequest) {
  if (!isTelegramWebhook(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return jsonError("Unauthorized", 401);
  }

  // 200 whatever the update held: any other answer makes Telegram resend it.
  await handleTelegramUpdate(await jsonBody(req));
  return NextResponse.json({ ok: true });
}
