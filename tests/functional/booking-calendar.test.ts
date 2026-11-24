import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminToken,
  makeRequest,
  memberToken,
  params,
  resetApp,
} from "../helpers/app";
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
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
};
const sent = (call = 0) => send.mock.calls[call][0] as Sent;

describe("the confirmation a booking sends", () => {
  it("carries the booking as a plain calendar file and a Google Calendar button", async () => {
    const res = await book({});
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(sent().to).toEqual(["ada@example.com"]);
    const [file] = sent().attachments!;
    expect(file.filename).toBe("booking.ics");
    const ics = file.content.toString("utf8").replace(/\r\n /g, "");
    expect(ics).toContain(`UID:${id}@scheduler.example.test`);
    expect(ics).toContain("STATUS:CONFIRMED");
    // A file, not an invitation, so Gmail shows no "Report spam" panel.
    expect(file.contentType).toBe("application/ics");
    expect(ics).toContain("METHOD:PUBLISH");
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

describe("the admin cancelling it", () => {
  async function cancel(id: string) {
    vi.setSystemTime(new Date(`${DAY}T12:05:00`));
    const route = await import("@/app/api/reservations/[id]/route");
    return settled(
      route.PATCH(
        makeRequest(`/api/reservations/${id}`, {
          method: "PATCH",
          token: adminToken(),
          body: { status: "cancelled" },
        }),
        params({ id }),
      ),
    );
  }

  it("emails no calendar data, only a reminder to delete the entry", async () => {
    const { id } = (await (await book({})).json()) as { id: string };
    expect((await cancel(id)).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent(1).attachments).toBeUndefined();
    expect(sent(1).html).toContain(
      "If you added this booking to your calendar, delete it there",
    );
  });
});

describe("the guest cancelling it", () => {
  it("emails a receipt with no calendar data, only a reminder to delete the entry", async () => {
    const booked = (await (await book({})).json()) as {
      id: string;
      cancelToken: string;
    };
    vi.setSystemTime(new Date(`${DAY}T12:05:00`));
    const cancel = await import("@/app/api/cancel/route");
    const res = await settled(
      cancel.POST(
        makeRequest("/api/cancel", {
          method: "POST",
          body: { token: booked.cancelToken },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent(1).subject).toBe(
      "Your Booth 1 reservation is cancelled for Thursday, 16 July 2026",
    );
    expect(sent(1).attachments).toBeUndefined();
    expect(sent(1).html).toContain(
      "If you added this booking to your calendar, delete it there",
    );
  });
});
