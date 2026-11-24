import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, memberToken, resetApp } from "../helpers/app";
import { settled } from "../helpers/after";

// The real mailer runs; only Resend itself is stubbed, so the email is what a guest gets.
const send = vi.fn().mockResolvedValue({ data: { id: "em_1" }, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/lib/slack", () => ({
  postReservationToSlack: vi.fn().mockResolvedValue("sent"),
}));

const DAY = "2026-07-16";

beforeEach(() => {
  send.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T12:00:00`));
  vi.stubEnv("RESEND_API_KEY", "re_test");
  resetApp();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function book(body: Record<string, unknown>) {
  const route = await import("@/app/api/reservations/route");
  return settled(
    route.POST(
      makeRequest("/api/reservations", {
        method: "POST",
        token: memberToken("Ada Lovelace", "ada@example.com"),
        body: {
          boothId: "booth-1",
          date: DAY,
          start: "14:00",
          end: "15:00",
          ...body,
        },
      }),
    ),
  );
}

type Sent = {
  to: string[];
  html: string;
  attachments?: { filename: string; content: Buffer }[];
};
const sent = () => send.mock.calls[0][0] as Sent;

describe("the confirmation a booking sends", () => {
  it("carries the booking as an .ics and a Google Calendar button", async () => {
    const res = await book({});
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(sent().to).toEqual(["ada@example.com"]);
    const [file] = sent().attachments!;
    expect(file.filename).toBe("booking.ics");
    const ics = file.content.toString("utf8").replace(/\r\n /g, "");
    expect(ics).toContain(`UID:${id}@scheduler.example.test`);
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(sent().html).toContain("Add to Google Calendar");
  });

  it("holds every date of a weekly repeat", async () => {
    const res = await book({ repeatWeeks: 3 });
    expect(res.status).toBe(201);
    const ics = sent().attachments![0].content.toString("utf8");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(send).toHaveBeenCalledOnce();
  });

  it("sends a request awaiting approval as tentative", async () => {
    const res = await book({ start: "13:00", end: "15:30", note: "Workshop" });
    expect(
      ((await res.json()) as { reservation: { status: string } }).reservation
        .status,
    ).toBe("pending");
    expect(sent().attachments![0].content.toString("utf8")).toContain(
      "STATUS:TENTATIVE",
    );
  });
});
