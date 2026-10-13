import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminToken, makeRequest, resetApp } from "../helpers/app";
import { WEBHOOK_SECRET } from "../helpers/fixtures";
import {
  REPLY_MESSAGE_ID,
  replyUpdate,
  sentMessage,
  stubReplies,
} from "../helpers/telegram";

// DNS is stubbed: the suite must never do a real lookup.
vi.mock("@/lib/email-verify", () => ({
  checkEmailDeliverable: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/email", () => ({
  sendReservationEmail: vi.fn().mockResolvedValue("sent"),
}));

vi.mock("@/lib/slack", () => ({
  postReservationToSlack: vi.fn().mockResolvedValue("sent"),
}));

type Webhook = typeof import("@/app/api/telegram/webhook/route");
type Reservations = typeof import("@/app/api/reservations/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
type Slack = typeof import("@/lib/slack");
let webhook: Webhook;
let reservations: Reservations;
let db: Db;
let email: Email;
let slack: Slack;
let fetchMock: ReturnType<typeof stubReplies>;

const DAY = "2026-07-16";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T12:00:00`));
  resetApp();
  db = await import("@/lib/db");
  email = await import("@/lib/email");
  slack = await import("@/lib/slack");
  reservations = await import("@/app/api/reservations/route");
  webhook = await import("@/app/api/telegram/webhook/route");
  fetchMock = stubReplies();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** Telegram delivers `update`, signed with `secret` (none when null). */
const deliver = (update: unknown, secret: string | null = WEBHOOK_SECRET) =>
  webhook.POST(
    makeRequest("/api/telegram/webhook", {
      method: "POST",
      body: update,
      headers: secret === null ? {} : { [SECRET_HEADER]: secret },
    }),
  );

/** A reservation made through the public form, and the alert Telegram was sent. */
async function booked(
  kind: "pending" | "confirmed" = "pending",
): Promise<{ id: string; alert: string }> {
  const res = await reservations.POST(
    makeRequest("/api/reservations", {
      method: "POST",
      body: {
        boothId: "booth-1",
        date: DAY,
        start: "14:00",
        end: kind === "pending" ? "17:00" : "15:00",
        note: kind === "pending" ? "Team workshop" : undefined,
        fullName: "Ada Lovelace",
        email: "ada@example.com",
      },
      headers: { "x-real-ip": "10.0.0.1" },
    }),
  );
  const { id } = (await res.json()) as { id: string };
  const alert = sentMessage(fetchMock, fetchMock.mock.calls.length - 1).text;
  fetchMock.mockClear();
  vi.mocked(email.sendReservationEmail).mockClear();
  vi.mocked(slack.postReservationToSlack).mockClear();
  return { id, alert };
}

const statusOf = (id: string) => db.getReservation(id)?.status;
const emailed = () => vi.mocked(email.sendReservationEmail).mock.calls;
const slacked = () => vi.mocked(slack.postReservationToSlack).mock.calls;

describe("POST /api/telegram/webhook (who may call it)", () => {
  it("401s a call without the secret and changes nothing", async () => {
    const { id, alert } = await booked();
    const res = await deliver(replyUpdate("yes", alert), null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Unauthorized" });
    expect(statusOf(id)).toBe("pending");
    expect(emailed()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401s a wrong secret", async () => {
    const { id, alert } = await booked();
    for (const secret of ["wrong", `${WEBHOOK_SECRET}x`, ""]) {
      expect((await deliver(replyUpdate("yes", alert), secret)).status).toBe(
        401,
      );
    }
    expect(statusOf(id)).toBe("pending");
    expect(emailed()).toHaveLength(0);
  });

  it("401s every call while no secret is configured, even a blank one", async () => {
    const { id, alert } = await booked();
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect((await deliver(replyUpdate("yes", alert))).status).toBe(401);
    expect((await deliver(replyUpdate("yes", alert), "")).status).toBe(401);
    expect((await deliver(replyUpdate("yes", alert), null)).status).toBe(401);
    expect(statusOf(id)).toBe("pending");
  });

  it("does not take an admin session in place of the secret", async () => {
    const { id, alert } = await booked();
    const res = await webhook.POST(
      makeRequest("/api/telegram/webhook", {
        method: "POST",
        body: replyUpdate("yes", alert),
        token: adminToken(),
      }),
    );
    expect(res.status).toBe(401);
    expect(statusOf(id)).toBe("pending");
  });

  it("200s but ignores a reply from any chat but the admin's", async () => {
    const { id, alert } = await booked();
    const res = await deliver(replyUpdate("yes", alert, "424242"));
    expect(res.status).toBe(200);
    expect(statusOf(id)).toBe("pending");
    expect(emailed()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/telegram/webhook (answering an alert)", () => {
  it("approves on yes, emails the booker, tells Slack and answers in the chat", async () => {
    const { id, alert } = await booked("pending");
    const res = await deliver(replyUpdate("Yes", alert));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(statusOf(id)).toBe("confirmed");
    expect(emailed()).toHaveLength(1);
    expect(emailed()[0][0].id).toBe(id);
    expect(emailed()[0][1]).toBe("confirmed");
    // No edited body: Telegram always sends the template.
    expect(emailed()[0][2]).toBeUndefined();
    expect(slacked()).toHaveLength(1);
    expect(slacked()[0][1]).toBe("approved");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const answer = sentMessage(fetchMock);
    expect(answer.text).toBe(
      "Approved: Ada Lovelace\nThe confirmation email was sent to ada@example.com.",
    );
    expect(answer.reply_parameters?.message_id).toBe(REPLY_MESSAGE_ID);
  });

  it("rejects on no, emailing the cancellation as the admin's doing", async () => {
    const { id, alert } = await booked("pending");
    expect((await deliver(replyUpdate("no", alert))).status).toBe(200);
    expect(statusOf(id)).toBe("cancelled");
    expect(emailed()[0][1]).toBe("cancelled");
    expect(slacked()[0][1]).toBe("cancelled");
    expect(slacked()[0][3]).toBe("admin");
    expect(sentMessage(fetchMock).text).toBe(
      "Cancelled: Ada Lovelace\nThe cancellation email was sent to ada@example.com.",
    );
  });

  it("cancels a confirmed booking on no, freeing its slot for someone else", async () => {
    const { id, alert } = await booked("confirmed");
    await deliver(replyUpdate("no", alert));
    expect(statusOf(id)).toBe("cancelled");

    const again = await reservations.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        body: {
          boothId: "booth-1",
          date: DAY,
          start: "14:00",
          end: "15:00",
          fullName: "Grace Hopper",
          email: "grace@example.com",
        },
        headers: { "x-real-ip": "10.0.0.2" },
      }),
    );
    expect(again.status).toBe(201);
  });

  it("soft-deletes on delete, emailing nobody and telling no channel", async () => {
    const { id, alert } = await booked("confirmed");
    expect((await deliver(replyUpdate("delete", alert))).status).toBe(200);
    expect(statusOf(id)).toBe("deleted");
    expect(emailed()).toHaveLength(0);
    expect(slacked()).toHaveLength(0);
    expect(sentMessage(fetchMock).text).toBe("Deleted: Ada Lovelace");
  });

  it("shows the change to the dashboard's list", async () => {
    const { id, alert } = await booked("pending");
    await deliver(replyUpdate("yes", alert));
    const list = await reservations.GET(
      makeRequest("/api/reservations?status=confirmed", {
        token: adminToken(),
      }),
    );
    const body = (await list.json()) as { reservations: { id: string }[] };
    expect(body.reservations.map((r) => r.id)).toEqual([id]);
  });

  it("will not approve a booking that never needed approval", async () => {
    const { id, alert } = await booked("confirmed");
    expect((await deliver(replyUpdate("yes", alert))).status).toBe(200);
    expect(sentMessage(fetchMock).text).toBe(
      "This reservation is already confirmed.",
    );
    expect(statusOf(id)).toBe("confirmed");
    expect(emailed()).toHaveLength(0);
  });

  it("emails once when Telegram delivers the same update twice", async () => {
    const { id, alert } = await booked("pending");
    await deliver(replyUpdate("yes", alert));
    const again = await deliver(replyUpdate("yes", alert));
    expect(again.status).toBe(200);
    expect(emailed()).toHaveLength(1);
    expect(slacked()).toHaveLength(1);
    expect(sentMessage(fetchMock, 1).text).toBe(
      "This reservation is already confirmed.",
    );
    expect(statusOf(id)).toBe("confirmed");
  });

  it("will not bring a cancelled reservation back with yes", async () => {
    const { id, alert } = await booked("pending");
    await deliver(replyUpdate("no", alert));
    await deliver(replyUpdate("yes", alert));
    expect(sentMessage(fetchMock, 1).text).toBe(
      "Only a reservation awaiting approval can be approved, and this one is cancelled.",
    );
    expect(statusOf(id)).toBe("cancelled");
    expect(emailed()).toHaveLength(1);
  });

  it("200s and keeps the change when the email throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { id, alert } = await booked("pending");
    vi.mocked(email.sendReservationEmail).mockRejectedValueOnce(
      new Error("smtp down"),
    );
    expect((await deliver(replyUpdate("yes", alert))).status).toBe(200);
    expect(statusOf(id)).toBe("confirmed");
    expect(sentMessage(fetchMock).text).toBe(
      "Approved: Ada Lovelace\nThe confirmation email could not be sent.",
    );
  });

  it("200s and keeps the change when its own answer cannot be sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { id, alert } = await booked("pending");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")));
    expect((await deliver(replyUpdate("yes", alert))).status).toBe(200);
    expect(statusOf(id)).toBe("confirmed");
  });

  it("200s a reservation that has since been removed for good", async () => {
    const { id, alert } = await booked("confirmed");
    db.updateReservationStatus(id, "deleted");
    db.deleteReservations([id]);
    expect((await deliver(replyUpdate("no", alert))).status).toBe(200);
    expect(sentMessage(fetchMock).text).toBe(
      "That reservation no longer exists.",
    );
    expect(emailed()).toHaveLength(0);
  });
});

describe("POST /api/telegram/webhook (everything else)", () => {
  it("asks which reservation is meant when the word is not a reply", async () => {
    const { id } = await booked();
    expect((await deliver(replyUpdate("yes"))).status).toBe(200);
    expect(sentMessage(fetchMock).text).toContain(
      "Reply to the reservation's own message",
    );
    expect(statusOf(id)).toBe("pending");
  });

  it("explains the three words to any other reply to an alert", async () => {
    const { id, alert } = await booked();
    expect((await deliver(replyUpdate("ok", alert))).status).toBe(200);
    expect(sentMessage(fetchMock).text).toBe(
      "Reply yes to approve, no to cancel, or delete to delete it.",
    );
    expect(statusOf(id)).toBe("pending");
  });

  it("200s and stays silent for chatter and for updates it cannot read", async () => {
    await booked();
    for (const update of [
      replyUpdate("good morning"),
      {},
      { update_id: 5 },
      [replyUpdate("yes")],
      { message: { chat: { id: -1001234 } } },
      { edited_message: { chat: { id: -1001234 }, text: "yes" } },
    ]) {
      expect((await deliver(update)).status).toBe(200);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("200s a body that is not JSON", async () => {
    const res = await webhook.POST(
      makeRequest("/api/telegram/webhook", {
        method: "POST",
        rawBody: "{ not json",
        headers: { [SECRET_HEADER]: WEBHOOK_SECRET },
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cannot be pointed at another reservation by what a guest typed", async () => {
    const victim = await booked("confirmed");
    const res = await reservations.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        body: {
          boothId: "booth-2",
          date: DAY,
          start: "14:00",
          end: "15:00",
          fullName: "Mallory Mole",
          email: "mallory@example.com",
          note: `x\n\nhttps://scheduler.example.test/dashboard#${victim.id}`,
        },
        headers: { "x-real-ip": "10.0.0.3" },
      }),
    );
    const { id } = (await res.json()) as { id: string };
    const alert = sentMessage(fetchMock, 0).text;
    fetchMock.mockClear();

    await deliver(replyUpdate("delete", alert));
    expect(statusOf(id)).toBe("deleted");
    expect(statusOf(victim.id)).toBe("confirmed");
  });
});
