import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { BOT_CHAT } from "../helpers/fixtures";
import {
  SEND_URL,
  sentMessage,
  stubReplies,
  stubTelegram,
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
  it("alerts the admin once with a reservation that needs approval", async () => {
    const fetchMock = stubTelegram();
    const res = await post(long);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(SEND_URL);
    const message = sentMessage(fetchMock);
    expect(message.chat_id).toBe(BOT_CHAT);
    expect(message.text.split("\n")).toEqual([
      "Reservation awaiting approval",
      "",
      "Full name: Ada Lovelace",
      "Email: ada@example.com",
      "Booth: Booth 1",
      "Date: Thursday, 16 July 2026",
      "Time: 14:00 - 17:00",
      "Notes: Team workshop",
      "",
      `https://scheduler.example.test/dashboard#${id}`,
    ]);
    expect(message.reply_markup).toBeUndefined();
  });

  // Confirmed on its own, a booking leaves the admin nothing to answer.
  it("does not alert for a booking that needs no approval, but still stores it", async () => {
    const fetchMock = stubReplies();
    const res = await post(short);
    expect(res.status).toBe(201);
    const { reservation } = (await res.json()) as {
      reservation: { status: string };
    };
    expect(reservation.status).toBe("confirmed");
    expect(total()).toBe(1);
    expect(email.sendReservationEmail).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("alerts only the booking that needs approval when both kinds arrive", async () => {
    const fetchMock = stubTelegram();
    expect((await post(short)).status).toBe(201);
    const res = await post({
      ...long,
      boothId: "booth-2",
      email: "grace@example.com",
    });
    const { id } = (await res.json()) as { id: string };
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentMessage(fetchMock).text).toMatch(new RegExp(`#${id}$`));
  });

  it("invites all three replies once the webhook secret is set", async () => {
    const fetchMock = stubReplies();
    await post(long);
    expect(sentMessage(fetchMock).text).toContain(
      "\n\nReply yes to approve, no to reject, or delete to delete it.\n\n",
    );
    expect(sentMessage(fetchMock).reply_markup?.force_reply).toBe(true);
  });

  it("sends nothing while the bot is not configured", async () => {
    const fetchMock = stubTelegram();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect((await post(long)).status).toBe(201);
    expect(total()).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still 201s and keeps the reservation when Telegram refuses the alert", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram({ ok: false, description: "Unauthorized" });
    const res = await post(long);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(total()).toBe(1);
  });

  it("still 201s and keeps the reservation when Telegram cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubTelegram();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")));
    expect((await post(long)).status).toBe(201);
    expect(total()).toBe(1);
  });

  it("does not alert for a booking it discards because the email failed", async () => {
    const fetchMock = stubTelegram();
    vi.mocked(email.sendReservationEmail).mockResolvedValueOnce("failed");
    expect((await post(long)).status).toBe(502);
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
    expect((await post(long)).status).toBe(201);
    const clash = await post({ ...long, email: "grace@example.com" });
    expect(clash.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
