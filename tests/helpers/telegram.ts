// Telegram's sendMessage, stubbed so no request ever leaves the process.
import { vi } from "vitest";
import { BOT_CHAT, BOT_TOKEN, WEBHOOK_SECRET } from "./fixtures";

export const SEND_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

type FetchMock = ReturnType<typeof vi.fn>;

/** Every call is answered with `reply` as its JSON body. */
export function stubFetch(reply: unknown = { ok: true }): FetchMock {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ json: () => Promise.resolve(reply) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The alert switched on; undo with vi.unstubAllEnvs and vi.unstubAllGlobals. */
export function stubTelegram(reply: unknown = { ok: true }): FetchMock {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
  vi.stubEnv("TELEGRAM_CHAT_ID", BOT_CHAT);
  return stubFetch(reply);
}

/** The alert plus the webhook's secret, which is what lets it be answered. */
export function stubReplies(reply: unknown = { ok: true }): FetchMock {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
  return stubTelegram(reply);
}

/** The JSON body of a sendMessage call, as Telegram would have received it. */
export function sentMessage(
  fetchMock: FetchMock,
  call: number = 0,
): {
  chat_id: string;
  text: string;
  link_preview_options: { is_disabled: boolean };
  reply_markup?: { force_reply: boolean; input_field_placeholder: string };
  reply_parameters?: {
    message_id: number;
    allow_sending_without_reply: boolean;
  };
} {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

/** The id Telegram gives the admin's message in replyUpdate. */
export const REPLY_MESSAGE_ID = 77;

/** The update for `text` sent in `chat`, as a reply to `alert` when one is given. */
export function replyUpdate(
  text: string,
  alert?: string,
  chat: string = BOT_CHAT,
): Record<string, unknown> {
  return {
    update_id: 1,
    message: {
      message_id: REPLY_MESSAGE_ID,
      chat: { id: Number(chat) },
      text,
      ...(alert !== undefined && {
        reply_to_message: { message_id: 42, text: alert },
      }),
    },
  };
}
