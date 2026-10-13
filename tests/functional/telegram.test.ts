import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { BOT_CHAT, WEBHOOK_SECRET } from "../helpers/fixtures";
import { SEND_URL, sentMessage, stubTelegram } from "../helpers/telegram";

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

type Route = typeof import("@/app/api/reservations/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
let route: Route;
let db: Db;
let email: Email;

const DAY = "2026-07-16";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T12:00:00`));
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/reservations/route");
  email = await import("@/lib/email");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const short = {
  boothId: "booth-1",
  date: DAY,
  start: "14:00",
  end: "15:00",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
};
const long = { ...short, end: "17:00", note: "Team workshop" };

const post = (body: unknown) =>
  route.POST(
    makeRequest("/api/reservations", {
      method: "POST",
      body,
      headers: { "x-real-ip": "10.0.0.1" },
    }),
  );
const total = () => db.queryReservations().total;

describe("POST /api/reservations (Telegram alert)", () => {
  it("alerts the admin once with the reservation it has just stored", async () => {
    const fetchMock = stubTelegram();
    const res = await post(short);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(SEND_URL);
    const message = sentMessage(fetchMock);
    expect(message.chat_id).toBe(BOT_CHAT);
    expect(message.text.split("\n")).toEqual([
      "New reservation",
      "",
      "Full name: Ada Lovelace",
      "Email: ada@example.com",
      "Booth: Booth 1",
      "Date: Thursday, 16 July 2026",
      "Time: 14:00 - 15:00",
      "",
      `https://scheduler.example.test/dashboard#${id}`,
    ]);
    expect(message.reply_markup).toBeUndefined();
  });

  it("says so, and carries the note, when the reservation needs approval", async () => {
    const fetchMock = stubTelegram();
    expect((await post(long)).status).toBe(201);
    const lines = sentMessage(fetchMock).text.split("\n");
    expect(lines[0]).toBe("Reservation awaiting approval");
    expect(lines).toContain("Time: 14:00 - 17:00");
    expect(lines).toContain("Notes: Team workshop");
  });

  it("invites the replies that apply once the webhook secret is set", async () => {
    const fetchMock = stubTelegram();
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
    await post(short);
    await post({ ...long, boothId: "booth-2", email: "grace@example.com" });

    expect(sentMessage(fetchMock, 0).text).toContain(
      "\n\nReply no to cancel, or delete to delete it.\n\n",
    );
    expect(sentMessage(fetchMock, 0).reply_markup?.force_reply).toBe(true);
    expect(sentMessage(fetchMock, 1).text).toContain(
      "\n\nReply yes to approve, no to reject, or delete to delete it.\n\n",
    );
  });

  it("sends nothing while the bot is not configured", async () => {
    const fetchMock = stubTelegram();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect((await post(short)).status).toBe(201);
    expect(total()).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still 201s and keeps the reservation when Telegram refuses the alert", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram({ ok: false, description: "Unauthorized" });
    const res = await post(short);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(total()).toBe(1);
  });

  it("still 201s and keeps the reservation when Telegram cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")));
    expect((await post(short)).status).toBe(201);
    expect(total()).toBe(1);
  });

  it("does not alert for a booking it discards because the email failed", async () => {
    const fetchMock = stubTelegram();
    vi.mocked(email.sendReservationEmail).mockResolvedValueOnce("failed");
    expect((await post(short)).status).toBe(502);
    expect(total()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not alert for a request it refuses", async () => {
    const fetchMock = stubTelegram();
    const refused = [
      await post({ ...short, fullName: "" }),
      await post({ ...short, boothId: "booth-9" }),
      await post({ ...short, start: "09:00", end: "10:00" }),
      await post({ ...short, end: "17:00" }),
      await route.POST(
        makeRequest("/api/reservations", {
          method: "POST",
          rawBody: "{ not json",
        }),
      ),
    ];
    expect(refused.map((r) => r.status)).toEqual([400, 400, 400, 400, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(total()).toBe(0);
  });

  it("alerts for the first booking of a slot and not for the 409 after it", async () => {
    const fetchMock = stubTelegram();
    expect((await post(short)).status).toBe(201);
    const clash = await post({ ...short, email: "grace@example.com" });
    expect(clash.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
