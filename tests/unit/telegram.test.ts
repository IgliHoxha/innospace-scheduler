import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REPLY_HINT,
  newReservationText,
  notifyNewReservation,
  repliesEnabled,
  reservationIdIn,
  sendTelegramMessage,
} from "@/lib/telegram";
import { boothNameIn } from "@/lib/templates";
import type { Reservation } from "@/lib/types";
import { BOT_CHAT, BOT_TOKEN, WEBHOOK_SECRET } from "../helpers/fixtures";
import {
  SEND_URL,
  sentMessage,
  stubFetch,
  stubReplies,
  stubTelegram,
} from "../helpers/telegram";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const booths = [{ id: "booth-1", name: "Booth 1" }];
const boothName = (id: string | undefined) => boothNameIn(booths, id);

const RESERVATION: Reservation = {
  id: "36added1-cecc-494d-bce9-1809dd7eb4b2",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  boothId: "booth-1",
  startsAt: "2026-07-16T09:30",
  endsAt: "2026-07-16T11:00",
  note: "Client call",
  status: "pending",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
};
const CONFIRMED: Reservation = { ...RESERVATION, status: "confirmed" };

const OTHER_ID = "9f1c2d3e-0000-4abc-8def-123456789abc";
const DASHBOARD = "https://scheduler.example.test/dashboard";
const LINK = `${DASHBOARD}#${RESERVATION.id}`;
const text = (r: Reservation) => newReservationText(r, boothName);

describe("newReservationText", () => {
  it("labels the name, email, booth, date, time and notes, then links", () => {
    expect(text(RESERVATION)).toBe(
      [
        "Reservation awaiting approval",
        "",
        "Full name: Ada Lovelace",
        "Email: ada@example.com",
        "Booth: Booth 1",
        "Date: Thursday, 16 July 2026",
        "Time: 09:30 - 11:00",
        "Notes: Client call",
        "",
        LINK,
      ].join("\n"),
    );
  });

  it("has no notes line for a reservation without a note", () => {
    const lines = text({ ...RESERVATION, note: undefined }).split("\n");
    expect(lines).not.toContain("Notes: Client call");
    expect(lines.slice(-3)).toEqual(["Time: 09:30 - 11:00", "", LINK]);
    expect(text({ ...RESERVATION, note: "   " })).not.toContain("Notes:");
  });

  it("leaves out a name or an email that was never given", () => {
    const bare = text({ ...RESERVATION, fullName: undefined, email: " " });
    expect(bare).not.toContain("Full name:");
    expect(bare).not.toContain("Email:");
    expect(bare).toContain("Booth: Booth 1");
  });

  it("names a booth it does not know by its id", () => {
    expect(text({ ...RESERVATION, boothId: "booth-9" })).toContain(
      "Booth: booth-9",
    );
  });

  it("keeps a note's line breaks and markup characters as typed", () => {
    const note = "<b>bold</b> _under_ *star*\n[x](y) & `tick`";
    expect(text({ ...RESERVATION, note })).toContain(`Notes: ${note}\n\n`);
  });

  it("links to APP_BASE_URL without doubling the slash", () => {
    vi.stubEnv("APP_BASE_URL", "https://staging.example.com/");
    expect(
      text(RESERVATION).endsWith(
        `\n\nhttps://staging.example.com/dashboard#${RESERVATION.id}`,
      ),
    ).toBe(true);
  });

  it("stays well inside Telegram's 4096 characters at every field's cap", () => {
    const full = text({
      ...RESERVATION,
      fullName: "n".repeat(80),
      email: "e".repeat(254),
      note: "🎉".repeat(500),
    });
    expect(full.length).toBeLessThan(4096);
  });

  it("offers no reply until replies are switched on", () => {
    expect(text(RESERVATION)).not.toContain("Reply");
  });

  it("offers all three reply words once replies are on", () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
    expect(text(RESERVATION).split("\n").slice(-4)).toEqual([
      "",
      "Reply yes to approve, no to reject, or delete to delete it.",
      "",
      LINK,
    ]);
  });
});

describe("reservationIdIn", () => {
  it("reads the reservation back out of its own alert", () => {
    expect(reservationIdIn(text(RESERVATION))).toBe(RESERVATION.id);
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
    expect(reservationIdIn(text(RESERVATION))).toBe(RESERVATION.id);
  });

  it("still reads it after Telegram has trimmed or padded the end", () => {
    expect(reservationIdIn(`${text(RESERVATION)}\n `)).toBe(RESERVATION.id);
  });

  it("cannot be steered by a link the guest typed into a field", () => {
    const forged = `${DASHBOARD}#${OTHER_ID}`;
    const alert = text({
      ...RESERVATION,
      fullName: forged,
      note: `please\n\n${forged}`,
    });
    expect(reservationIdIn(alert)).toBe(RESERVATION.id);
  });

  it.each([
    ["an ordinary message", "yes"],
    ["an empty message", ""],
    ["the dashboard link with no id", DASHBOARD],
    ["an id that is not the last thing", `${LINK}\nthanks`],
    ["an id of the wrong shape", `${DASHBOARD}#rs_1`],
    ["an id that is too long", `${LINK}0`],
    ["an id with no link", RESERVATION.id],
  ])("finds nothing in %s", (_what, message) => {
    expect(reservationIdIn(message)).toBeNull();
  });

  it.each([[undefined], [null], [42], [{ text: LINK }]])(
    "finds nothing in a non-string (%j)",
    (value) => {
      expect(reservationIdIn(value)).toBeNull();
    },
  );
});

describe("repliesEnabled", () => {
  it("is off until the webhook secret is set, and blank counts as unset", () => {
    expect(repliesEnabled()).toBe(false);
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "  ");
    expect(repliesEnabled()).toBe(false);
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
    expect(repliesEnabled()).toBe(true);
  });
});

describe("notifyNewReservation", () => {
  const notify = (r: Reservation = RESERVATION) =>
    notifyNewReservation(r, boothName);

  it.each([
    ["the token", "TELEGRAM_CHAT_ID", BOT_CHAT],
    ["the chat id", "TELEGRAM_BOT_TOKEN", BOT_TOKEN],
  ])("is skipped while %s is unset", async (_missing, name, value) => {
    vi.stubEnv(name, value);
    const fetchMock = stubFetch();
    expect(await notify()).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is skipped while both are blank", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "  ");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    const fetchMock = stubFetch();
    expect(await notify()).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the alert to the bot's sendMessage as plain text", async () => {
    const fetchMock = stubTelegram();
    expect(await notify()).toBe("sent");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SEND_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(sentMessage(fetchMock)).toEqual({
      chat_id: BOT_CHAT,
      text: text(RESERVATION),
      link_preview_options: { is_disabled: true },
    });
  });

  it("opens the reply box once replies are on, naming the words that apply", async () => {
    const fetchMock = stubReplies();
    await notify();
    expect(sentMessage(fetchMock).reply_markup).toEqual({
      force_reply: true,
      input_field_placeholder: "yes, no or delete",
    });
  });

  // Confirmed on its own, a booking leaves the admin nothing to answer.
  it("is skipped for a booking that needs no approval, without a request", async () => {
    const fetchMock = stubReplies();
    expect(await notify(CONFIRMED)).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([["cancelled"], ["deleted"]] as const)(
    "is skipped for a booking that is already %s",
    async (status) => {
      const fetchMock = stubTelegram();
      expect(await notify({ ...RESERVATION, status })).toBe("skipped");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("gives the request three seconds before giving up", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = stubTelegram();
    await notify();
    expect(timeout).toHaveBeenCalledWith(3000);
    expect(fetchMock.mock.calls[0][1].signal).toBe(
      timeout.mock.results[0].value,
    );
  });

  it("reports a failure and logs Telegram's reason when it refuses", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram({ ok: false, description: "Bad Request: chat not found" });
    expect(await notify()).toBe("failed");
    expect(log).toHaveBeenCalledWith(
      "[telegram] message was rejected:",
      "Bad Request: chat not found",
    );
  });

  it("reports a failure instead of throwing when the request fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")));
    expect(await notify()).toBe("failed");
    expect(log).toHaveBeenCalledWith("[telegram] request failed:", "timed out");
  });

  it("reports a failure when the answer is not JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      }),
    );
    expect(await notify()).toBe("failed");
  });

  it("reports a failure instead of throwing when the alert cannot be built", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = stubTelegram();
    vi.stubEnv("APP_BASE_URL", "");
    expect(await notify()).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the bot token out of the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`Failed to parse URL ${SEND_URL}`)),
    );
    await notify();
    expect(JSON.stringify(log.mock.calls)).not.toContain(BOT_TOKEN);
    expect(log.mock.calls[0][1]).toContain("bot[token]/sendMessage");
  });

  it("survives a rejection that is not an Error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("socket hang up"));
    expect(await notify()).toBe("failed");
    expect(log).toHaveBeenCalledWith(
      "[telegram] request failed:",
      "socket hang up",
    );
  });
});

describe("sendTelegramMessage", () => {
  it("sends the text to the admin's chat with whatever else it is given", async () => {
    const fetchMock = stubTelegram();
    expect(
      await sendTelegramMessage("Approved: Ada", {
        reply_parameters: { message_id: 7, allow_sending_without_reply: true },
      }),
    ).toBe("sent");
    expect(fetchMock.mock.calls[0][0]).toBe(SEND_URL);
    expect(sentMessage(fetchMock)).toEqual({
      chat_id: BOT_CHAT,
      text: "Approved: Ada",
      link_preview_options: { is_disabled: true },
      reply_parameters: { message_id: 7, allow_sending_without_reply: true },
    });
  });

  it("is skipped while the bot is not configured", async () => {
    const fetchMock = stubFetch();
    expect(await sendTelegramMessage("hello")).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a failure when Telegram refuses it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram({ ok: false, description: "Forbidden" });
    expect(await sendTelegramMessage("hello")).toBe("failed");
  });

  it("exports the fallback hint the alert and the replies share", () => {
    expect(REPLY_HINT).toBe(
      "Reply yes to approve, no to cancel, or delete to delete it.",
    );
  });
});
