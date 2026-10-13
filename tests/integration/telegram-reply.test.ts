import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDb } from "../helpers/app";
import {
  REPLY_MESSAGE_ID,
  replyUpdate,
  sentMessage,
  stubReplies,
} from "../helpers/telegram";
import type { Reservation } from "@/lib/types";

// A shared `send` keeps the mailer's singleton client observable.
const send = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

vi.mock("@/lib/slack", () => ({
  postReservationToSlack: vi.fn().mockResolvedValue("sent"),
}));

type Db = Awaited<ReturnType<typeof loadDb>>;
type Telegram = typeof import("@/lib/telegram");
type Reply = typeof import("@/lib/telegram-reply");
type Booths = typeof import("@/lib/booths");
type Slack = typeof import("@/lib/slack");
let db: Db;
let telegram: Telegram;
let reply: Reply;
let booths: Booths;
let slack: Slack;
let fetchMock: ReturnType<typeof stubReplies>;

beforeEach(async () => {
  db = await loadDb();
  telegram = await import("@/lib/telegram");
  reply = await import("@/lib/telegram-reply");
  booths = await import("@/lib/booths");
  slack = await import("@/lib/slack");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  fetchMock = stubReplies();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const seed = (
  status: "confirmed" | "pending" = "pending",
  over: Partial<Parameters<Db["createReservation"]>[0]> = {},
) =>
  db.createReservation(
    {
      boothId: "booth-1",
      startsAt: "2026-07-16T14:00",
      endsAt: "2026-07-16T15:00",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      ...over,
    },
    status,
  );

const alertFor = (r: Reservation) =>
  telegram.newReservationText(r, booths.boothName);

/** The admin answers `r`'s alert with `text`; resolves the bot's answer. */
async function answer(text: string, r: Reservation): Promise<string> {
  fetchMock.mockClear();
  await reply.handleTelegramUpdate(replyUpdate(text, alertFor(r)));
  return sentMessage(fetchMock).text;
}

const statusOf = (id: string) => db.getReservation(id)?.status;
const slackCalls = () => vi.mocked(slack.postReservationToSlack).mock.calls;

describe("answering a reservation alert", () => {
  it("approves a pending reservation and emails the confirmation", async () => {
    const r = seed("pending");
    expect(await answer("yes", r)).toBe(
      "Approved: Ada Lovelace\nThe confirmation email was sent to ada@example.com.",
    );
    expect(statusOf(r.id)).toBe("confirmed");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toEqual(["ada@example.com"]);
    expect(send.mock.calls[0][0].subject).toContain("is confirmed");
    expect(slackCalls()[0][1]).toBe("approved");
  });

  it("rejects a pending reservation, emails the cancellation and frees the slot", async () => {
    const r = seed("pending");
    expect(await answer("no", r)).toBe(
      "Cancelled: Ada Lovelace\nThe cancellation email was sent to ada@example.com.",
    );
    expect(statusOf(r.id)).toBe("cancelled");
    expect(send.mock.calls[0][0].subject).toContain("Update on your");
    expect(slackCalls()[0][1]).toBe("cancelled");
    expect(slackCalls()[0][3]).toBe("admin");
    expect(db.reservedRanges("booth-1", "2026-07-16")).toEqual([]);
  });

  it("cancels a confirmed reservation on no", async () => {
    const r = seed("confirmed");
    expect(await answer("no", r)).toContain("Cancelled: Ada Lovelace");
    expect(statusOf(r.id)).toBe("cancelled");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("soft-deletes on delete, emailing nobody and keeping the row", async () => {
    const r = seed("confirmed");
    expect(await answer("delete", r)).toBe("Deleted: Ada Lovelace");
    expect(statusOf(r.id)).toBe("deleted");
    expect(send).not.toHaveBeenCalled();
    expect(slackCalls()).toHaveLength(0);
    expect(db.queryReservations().total).toBe(0);
    expect(db.queryReservations({ filter: "deleted" }).total).toBe(1);
  });

  it("answers under the admin's own message", async () => {
    await answer("yes", seed("pending"));
    expect(sentMessage(fetchMock).reply_parameters).toEqual({
      message_id: REPLY_MESSAGE_ID,
      allow_sending_without_reply: true,
    });
  });

  it("acts on the reservation that was replied to, not the newest one", async () => {
    const first = seed("pending", { fullName: "First Guest" });
    const second = seed("pending", {
      fullName: "Second Guest",
      email: "second@example.com",
      boothId: "booth-2",
    });
    expect(await answer("no", first)).toContain("Cancelled: First Guest");
    expect(statusOf(first.id)).toBe("cancelled");
    expect(statusOf(second.id)).toBe("pending");
  });

  it("does nothing the second time, so a resent update cannot email twice", async () => {
    const r = seed("pending");
    await answer("yes", r);
    expect(await answer("yes", r)).toBe(
      "This reservation is already confirmed.",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(slackCalls()).toHaveLength(1);
  });

  it("will not approve a booking that was confirmed from the start", async () => {
    const r = seed("confirmed");
    expect(await answer("yes", r)).toBe(
      "This reservation is already confirmed.",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("will not bring a cancelled or deleted reservation back", async () => {
    const r = seed("pending");
    await answer("no", r);
    expect(await answer("yes", r)).toBe(
      "Only a reservation awaiting approval can be approved, and this one is cancelled.",
    );
    expect(await answer("no", r)).toBe(
      "This reservation is already cancelled.",
    );
    await answer("delete", r);
    expect(await answer("no", r)).toBe(
      "This reservation is deleted, so there is nothing to cancel.",
    );
    expect(await answer("delete", r)).toBe(
      "This reservation is already deleted.",
    );
    expect(statusOf(r.id)).toBe("deleted");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("approves a reservation with no address and says no email went", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = seed("pending", { email: undefined });
    expect(await answer("yes", r)).toBe(
      "Approved: Ada Lovelace\nNo confirmation email was sent.",
    );
    expect(statusOf(r.id)).toBe("confirmed");
  });

  it("still approves when the email is refused, and says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockResolvedValueOnce({ data: null, error: { message: "bounced" } });
    const r = seed("pending");
    expect(await answer("yes", r)).toBe(
      "Approved: Ada Lovelace\nThe confirmation email could not be sent.",
    );
    expect(statusOf(r.id)).toBe("confirmed");
  });

  it("says so when the reservation has been removed for good", async () => {
    const r = seed("confirmed");
    db.updateReservationStatus(r.id, "deleted");
    db.deleteReservations([r.id]);
    expect(await answer("no", r)).toBe("That reservation no longer exists.");
    expect(send).not.toHaveBeenCalled();
  });

  it("explains itself to a reply that is none of the three words", async () => {
    const r = seed("pending");
    expect(await answer("maybe tomorrow", r)).toBe(telegram.REPLY_HINT);
    expect(statusOf(r.id)).toBe("pending");
  });
});

describe("messages that are not an answer to an alert", () => {
  const handle = async (update: unknown) => {
    fetchMock.mockClear();
    await reply.handleTelegramUpdate(update);
  };

  it("asks which reservation is meant when a word arrives on its own", async () => {
    const r = seed("pending");
    await handle(replyUpdate("yes"));
    expect(sentMessage(fetchMock).text).toBe(reply.NO_TARGET);
    await handle(replyUpdate("delete", "Approved: Ada Lovelace"));
    expect(sentMessage(fetchMock).text).toBe(reply.NO_TARGET);
    expect(statusOf(r.id)).toBe("pending");
  });

  it("stays silent through ordinary chatter", async () => {
    await handle(replyUpdate("good morning"));
    await handle(replyUpdate("thanks", "see you at nine"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores every other chat, even one replying to a real alert", async () => {
    const r = seed("pending");
    await handle(replyUpdate("yes", alertFor(r), "999"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statusOf(r.id)).toBe("pending");
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores everything while no chat is configured", async () => {
    const r = seed("pending");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    await handle(replyUpdate("yes", alertFor(r)));
    expect(statusOf(r.id)).toBe("pending");
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "yes"],
    ["an empty object", {}],
    ["a message of the wrong type", { message: "yes" }],
    ["a message with no chat", { message: { text: "yes" } }],
    ["a photo with no text", { message: { chat: { id: -1001234 } } }],
    [
      "a text that is not a string",
      { message: { chat: { id: -1001234 }, text: { yes: true } } },
    ],
    [
      "an edited message",
      { edited_message: { chat: { id: -1001234 }, text: "yes" } },
    ],
  ])("shrugs off an update holding %s", async (_what, update) => {
    await expect(reply.handleTelegramUpdate(update)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws, even when the database fails mid-reply", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const alert = alertFor(seed("pending"));
    const failure = new Error("disk gone");
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      getReservation: vi.fn(() => {
        throw failure;
      }),
    }));
    try {
      const broken = await import("@/lib/telegram-reply");
      await expect(
        broken.handleTelegramUpdate(replyUpdate("yes", alert)),
      ).resolves.toBeUndefined();
    } finally {
      vi.doUnmock("@/lib/db");
    }
    expect(log).toHaveBeenCalledWith("[telegram] reply failed:", failure);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
