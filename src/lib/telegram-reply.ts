// An admin's yes / no / delete reply to an alert, carried out as the dashboard would.
import { safeEqual } from "./auth";
import { getReservation } from "./db";
import { optionalEnv } from "./env-app";
import {
  changeReservationStatus,
  type StatusChange,
} from "./reservation-actions";
import { REPLY_HINT, reservationIdIn, sendTelegramMessage } from "./telegram";
import { isActiveStatus, type ReservationStatus } from "./types";

export type ReplyAction = "approve" | "cancel" | "delete";

const REPLIES = new Map<string, ReplyAction>([
  ["yes", "approve"],
  ["no", "cancel"],
  ["delete", "delete"],
]);

const TARGET: Record<ReplyAction, ReservationStatus> = {
  approve: "confirmed",
  cancel: "cancelled",
  delete: "deleted",
};

export const NO_TARGET =
  "Reply to the reservation's own message, so I know which one you mean.";
export const GONE = "That reservation no longer exists.";

/** False for every caller while no secret is set, so the route fails closed. */
export function isTelegramWebhook(secret: string | null): boolean {
  const expected = optionalEnv("TELEGRAM_WEBHOOK_SECRET");
  return !!expected && !!secret && safeEqual(secret, expected);
}

/** Null when the text is not one of the three words. */
export function replyAction(text: string): ReplyAction | null {
  const word = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return REPLIES.get(word) ?? null;
}

/** Why the dashboard would not offer this action on that status, else null. */
export function refusalFor(
  action: ReplyAction,
  status: ReservationStatus,
): string | null {
  // Also what stops an update Telegram delivers twice from emailing twice.
  if (status === TARGET[action])
    return `This reservation is already ${status}.`;
  if (action === "approve" && status !== "pending")
    return `Only a reservation awaiting approval can be approved, and this one is ${status}.`;
  if (action === "cancel" && !isActiveStatus(status))
    return `This reservation is ${status}, so there is nothing to cancel.`;
  return null;
}

/** What the admin is told once a reply has been carried out. */
export function changeAnswer(
  { reservation, email }: StatusChange,
  action: ReplyAction,
): string {
  const who = reservation.fullName?.trim() || reservation.email || "the guest";
  if (action === "delete") return `Deleted: ${who}`;

  const [done, kind] =
    action === "approve"
      ? ["Approved", "confirmation"]
      : ["Cancelled", "cancellation"];
  const outcome =
    email === "sent"
      ? `The ${kind} email was sent to ${reservation.email}.`
      : email === "failed"
        ? `The ${kind} email could not be sent.`
        : `No ${kind} email was sent.`;
  return `${done}: ${who}\n${outcome}`;
}

async function answerTo(text: string, alert: unknown): Promise<string | null> {
  const action = replyAction(text);
  const id = reservationIdIn(alert);
  // Ordinary chatter: neither one of the three words nor a reply to an alert.
  if (!action && !id) return null;
  if (!id) return NO_TARGET;
  if (!action) return REPLY_HINT;

  const reservation = getReservation(id);
  if (!reservation) return GONE;
  const refusal = refusalFor(action, reservation.status);
  if (refusal) return refusal;

  const changed = await changeReservationStatus(id, TARGET[action]);
  return changed ? changeAnswer(changed, action) : GONE;
}

// The few fields read from Telegram's Update object.
type Update = {
  message?: {
    message_id?: number;
    chat?: { id?: number };
    text?: unknown;
    reply_to_message?: { text?: unknown };
  };
};

/** Never throws: the route must answer 200, or Telegram sends the update again. */
export async function handleTelegramUpdate(update: unknown): Promise<void> {
  try {
    const message = (update as Update | null)?.message;
    const chatId = optionalEnv("TELEGRAM_CHAT_ID");
    // Anyone can write to a bot, so only the configured chat is listened to.
    if (!message || !chatId || String(message.chat?.id) !== chatId) return;
    if (typeof message.text !== "string") return;

    const answer = await answerTo(message.text, message.reply_to_message?.text);
    if (!answer) return;
    await sendTelegramMessage(answer, {
      reply_parameters: {
        message_id: message.message_id,
        allow_sending_without_reply: true,
      },
    });
  } catch (err) {
    console.error("[telegram] reply failed:", err);
  }
}
