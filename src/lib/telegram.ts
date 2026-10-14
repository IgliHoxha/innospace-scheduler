// Posts new bookings to the admin's Telegram. Server-only: it reads the bot token.
import { optionalEnv, requireEnv } from "./env-app";
import type { Reservation } from "./types";
import { boothLabel, dateText, timeText, type BoothNamer } from "./templates";

/** "skipped" is no bot configured or nothing to approve; only "failed" means Telegram refused it. */
export type TelegramOutcome = "sent" | "skipped" | "failed";

const API_URL = "https://api.telegram.org";

// A hung POST would hold the booking's own response open behind it.
const TIMEOUT_MS = 3000;

/** The fallback wording, for a reply that is none of the three words. */
export const REPLY_HINT =
  "Reply yes to approve, no to cancel, or delete to delete it.";

/** Off until the webhook secret is set, which is what lets an alert be answered. */
export function repliesEnabled(): boolean {
  return !!optionalEnv("TELEGRAM_WEBHOOK_SECRET");
}

// Every alert is for a booking awaiting approval, so all three words apply to it.
const ALERT_HINT =
  "Reply yes to approve, no to reject, or delete to delete it.";
const ALERT_PLACEHOLDER = "yes, no or delete";

/** Plain text, no parse_mode: a guest's stray "_" or "<" would get it refused. */
export function newReservationText(
  r: Reservation,
  boothName: BoothNamer,
): string {
  // Unclipped: the booking route caps every field (MAX_* in types.ts).
  const details: [label: string, value: string][] = [
    ["Full name", r.fullName?.trim() ?? ""],
    ["Email", r.email?.trim() ?? ""],
    ["Booth", boothLabel(r, boothName)],
    ["Date", dateText(r)],
    ["Time", timeText(r)],
    ["Notes", r.note?.trim() ?? ""],
  ];
  return [
    "Reservation awaiting approval",
    "",
    ...details
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`),
    "",
    ...(repliesEnabled() ? [ALERT_HINT, ""] : []),
    // Last, past all guest text: a reply finds its reservation by this id.
    `${requireEnv("APP_BASE_URL").replace(/\/$/, "")}/dashboard#${r.id}`,
  ].join("\n");
}

const ALERT_ID =
  /\/dashboard#([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\s*$/;

/** The reservation an alert is about, read from its closing link, else null. */
export function reservationIdIn(text: unknown): string | null {
  return typeof text === "string" ? (ALERT_ID.exec(text)?.[1] ?? null) : null;
}

// The message is built inside the try, so nothing about it can throw past here.
async function send(
  message: () => Record<string, unknown>,
): Promise<TelegramOutcome> {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  const chatId = optionalEnv("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return "skipped";

  try {
    const res = await fetch(`${API_URL}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        // The only link is the login-gated dashboard, so a preview is noise.
        link_preview_options: { is_disabled: true },
        ...message(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) {
      console.error("[telegram] message was rejected:", data.description);
      return "failed";
    }
    return "sent";
  } catch (err) {
    // The token is part of the URL, so it is struck from whatever gets logged.
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      "[telegram] request failed:",
      reason.split(token).join("[token]"),
    );
    return "failed";
  }
}

/** Never throws: a notice must not cost anyone their slot. */
export async function notifyNewReservation(
  r: Reservation,
  boothName: BoothNamer,
): Promise<TelegramOutcome> {
  // An auto-confirmed booking needs nothing from the admin, so only one awaiting approval is sent.
  if (r.status !== "pending") return "skipped";
  return send(() => ({
    text: newReservationText(r, boothName),
    // Opens the reply box on this alert, so a typed word is a reply to it.
    ...(repliesEnabled() && {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: ALERT_PLACEHOLDER,
      },
    }),
  }));
}

/** Any other message to the admin's chat, with the same never-throws promise. */
export async function sendTelegramMessage(
  text: string,
  extra: Record<string, unknown> = {},
): Promise<TelegramOutcome> {
  return send(() => ({ text, ...extra }));
}
