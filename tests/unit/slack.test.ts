import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boothNameIn } from "@/lib/booths";
import type { Reservation } from "@/lib/types";

type Slack = typeof import("@/lib/slack");
let slack: Slack;

const booths = [{ id: "booth-1", name: "Booth 1" }];
const boothName = (id: string | undefined) => boothNameIn(booths, id);

const RESERVATION: Reservation = {
  id: "rs_1",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  boothId: "booth-1",
  startsAt: "2026-07-16T09:30",
  endsAt: "2026-07-16T11:00",
  status: "confirmed",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
};

const HOOK = "https://hooks.slack.com/services/T0/B0/secret";

beforeEach(async () => {
  vi.resetModules();
  slack = await import("@/lib/slack");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bodyOf = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
    text: string;
    blocks: { type: string; elements: { text: string }[] }[];
  };

describe("the Slack message", () => {
  type Event = "confirmed" | "pending" | "approved" | "cancelled";
  const text = (r: Reservation, event: Event = "confirmed") =>
    slack.slackReservationText(r, event, boothName);
  const body = (
    r: Reservation,
    event: Event = "confirmed",
    by?: "guest" | "admin",
  ) =>
    slack.slackReservationMessage(r, event, boothName, by).blocks[0] as {
      type: string;
      elements: { type: string; text: string }[];
    };

  it("summarises the booking in one line for the notification", () => {
    expect(text(RESERVATION)).toBe(
      "New reservation: Booth 1 · Thursday, 16 July 2026 · 09:30 - 11:00 (Ada Lovelace)",
    );
  });

  // Skimming a busy channel is the point, so the icon must differ by status.
  it("leads with an icon that tells the statuses apart", () => {
    expect(body(RESERVATION).elements[0].text).toMatch(/^:calendar: /);
    expect(body(RESERVATION, "pending").elements[0].text).toMatch(
      /^:hourglass_flowing_sand: /,
    );
    expect(body(RESERVATION, "cancelled").elements[0].text).toMatch(
      /^:small_red_triangle_down: /,
    );
  });

  // The booker is one of many; the admin is a single shared login.
  it("names the guest who cancelled, but calls the admin only by role", () => {
    expect(body(RESERVATION, "cancelled", "guest").elements[0].text).toContain(
      "Reservation cancelled by Ada Lovelace (guest)",
    );
    expect(body(RESERVATION, "cancelled", "admin").elements[0].text).toContain(
      "Reservation cancelled by the admin",
    );
    expect(
      body(RESERVATION, "cancelled", "admin").elements[0].text,
    ).not.toContain("Ada Lovelace (");
  });

  // Only the link and the dashboard can cancel, so unattributed means the link.
  it("defaults to the guest, falling back to the bare role when unnamed", () => {
    expect(body(RESERVATION, "cancelled").elements[0].text).toContain(
      "cancelled by Ada Lovelace (guest)",
    );
    expect(
      body({ ...RESERVATION, fullName: undefined }, "cancelled", "guest")
        .elements[0].text,
    ).toContain("cancelled by the guest");
  });

  // Only the dashboard approves, so it needs no actor, but it is not a new booking.
  it("announces an approval as its own event, on the confirmed icon", () => {
    const t = body(RESERVATION, "approved").elements[0].text;
    expect(t).toMatch(/^:calendar: /);
    expect(t).toContain("Reservation approved");
    expect(t).not.toContain("New reservation");
    expect(text(RESERVATION, "approved")).toMatch(/^Approved: /);
  });

  it("still carries the booking's details on a cancellation, so the slot is identifiable", () => {
    const t = body(RESERVATION, "cancelled", "admin").elements[0].text;
    expect(t).toContain("Booth 1 · Thursday, 16 July 2026 · 09:30 - 11:00");
    expect(t).toContain("Ada Lovelace · ada@example.com");
  });

  it("summarises a cancellation in one line too", () => {
    expect(text(RESERVATION, "cancelled")).toBe(
      "Cancelled: Booth 1 · Thursday, 16 July 2026 · 09:30 - 11:00 (Ada Lovelace)",
    );
  });

  it("says a pending request is awaiting approval, since that one needs an admin", () => {
    expect(text(RESERVATION, "pending")).toMatch(/^Awaiting approval: /);
    expect(body(RESERVATION, "pending").elements[0].text).toContain(
      "Reservation awaiting approval",
    );
    expect(body(RESERVATION).elements[0].text).toContain("New reservation");
  });

  it("carries booth, day, time, full name and email", () => {
    const t = body(RESERVATION).elements[0].text;
    expect(t).toContain("Booth 1 · Thursday, 16 July 2026 · 09:30 - 11:00");
    expect(t).toContain("Ada Lovelace · ada@example.com");
  });

  // A channel is skimmed, so the event must fit a glance: heading, when, who.
  it("fits in three lines, four with a note", () => {
    expect(body(RESERVATION).elements[0].text.split("\n")).toHaveLength(3);
    expect(
      body({ ...RESERVATION, note: "Board meeting" }).elements[0].text.split(
        "\n",
      ),
    ).toHaveLength(4);
  });

  it("includes a note only when one was written, set in italics", () => {
    expect(body(RESERVATION).elements[0].text).not.toContain("_");
    expect(
      body({ ...RESERVATION, note: "  Board meeting  " }).elements[0].text,
    ).toContain("_Board meeting_");
    expect(
      body({ ...RESERVATION, note: "   " }).elements[0].text,
    ).not.toContain("_");
  });

  // Slack reads these three as markup, so a note could forge a link.
  it("escapes the characters Slack treats as markup", () => {
    const t = body({
      ...RESERVATION,
      fullName: "Ada <b> & Co",
      note: "<https://evil.test|click me>",
    }).elements[0].text;
    expect(t).toContain("Ada &lt;b&gt; &amp; Co");
    expect(t).toContain("&lt;https://evil.test|click me&gt;");
    expect(t).not.toContain("<https://evil.test");
  });

  // The heading carries a name the booker chose, so it needs escaping too.
  it("escapes the name it credits a cancellation to", () => {
    expect(
      body({ ...RESERVATION, fullName: "Ada <b> & Co" }, "cancelled", "guest")
        .elements[0].text,
    ).toContain("cancelled by Ada &lt;b&gt; &amp; Co (guest)");
  });

  it("falls back to the email, then to a placeholder, when the name is missing", () => {
    expect(text({ ...RESERVATION, fullName: undefined })).toContain(
      "(ada@example.com)",
    );
    expect(
      text({ ...RESERVATION, fullName: undefined, email: undefined }),
    ).toContain("(someone)");
  });

  // A section renders full size; context is the only block Slack draws small.
  it("uses a context block, which is what keeps the type and the icon small", () => {
    expect(body(RESERVATION).type).toBe("context");
    expect(body(RESERVATION).elements[0].type).toBe("mrkdwn");
  });

  it("keeps a plain-text line beside the blocks, which notifications use", () => {
    const msg = slack.slackReservationMessage(
      RESERVATION,
      "confirmed",
      boothName,
    );
    expect(msg.text).toBe(text(RESERVATION));
    expect(msg.blocks).toHaveLength(1);
  });
});

describe("posting to Slack", () => {
  it("skips entirely when no webhook is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await slack.postReservationToSlack(RESERVATION, "confirmed", boothName),
    ).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts JSON to the webhook and reports it sent", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", HOOK);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await slack.postReservationToSlack(RESERVATION, "confirmed", boothName),
    ).toBe("sent");
    expect(fetchMock.mock.calls[0][0]).toBe(HOOK);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(bodyOf(fetchMock).text).toContain("New reservation: Booth 1");
  });

  // A hung webhook would hold the booking's own response open behind it.
  it("gives the request a timeout", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", HOOK);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await slack.postReservationToSlack(RESERVATION, "confirmed", boothName);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a refusal without throwing", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", HOOK);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await slack.postReservationToSlack(RESERVATION, "confirmed", boothName),
    ).toBe("failed");
    expect(err).toHaveBeenCalled();
  });

  it("swallows a network failure, so a booking never depends on Slack", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", HOOK);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      slack.postReservationToSlack(RESERVATION, "confirmed", boothName),
    ).resolves.toBe("failed");
    expect(err).toHaveBeenCalled();
  });

  it("never leaks the webhook URL into a log line", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", HOOK);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await slack.postReservationToSlack(RESERVATION, "confirmed", boothName);
    expect(JSON.stringify(err.mock.calls)).not.toContain("secret");
  });
});
