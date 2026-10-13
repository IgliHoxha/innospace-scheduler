import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDb } from "../helpers/app";

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
type Actions = typeof import("@/lib/reservation-actions");
type Slack = typeof import("@/lib/slack");
let db: Db;
let actions: Actions;
let slack: Slack;

beforeEach(async () => {
  db = await loadDb();
  actions = await import("@/lib/reservation-actions");
  slack = await import("@/lib/slack");
  vi.stubEnv("RESEND_API_KEY", "re_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const seed = (
  status: "confirmed" | "pending" = "confirmed",
  over: { email?: string } = {},
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

const slackCalls = () => vi.mocked(slack.postReservationToSlack).mock.calls;

describe("changeReservationStatus", () => {
  it("approves a pending reservation, emails the booker and tells Slack", async () => {
    const r = seed("pending");
    const changed = await actions.changeReservationStatus(r.id, "confirmed");

    expect(changed?.reservation.status).toBe("confirmed");
    expect(changed?.email).toBe("sent");
    expect(db.getReservation(r.id)?.status).toBe("confirmed");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toEqual(["ada@example.com"]);
    expect(send.mock.calls[0][0].subject).toContain("is confirmed");
    expect(slackCalls()).toHaveLength(1);
    expect(slackCalls()[0][1]).toBe("approved");
  });

  it("cancels a reservation, emails the cancellation and credits the admin", async () => {
    const r = seed();
    const changed = await actions.changeReservationStatus(r.id, "cancelled");

    expect(changed?.reservation.status).toBe("cancelled");
    expect(changed?.email).toBe("sent");
    expect(send.mock.calls[0][0].subject).toContain("Update on your");
    expect(slackCalls()[0][1]).toBe("cancelled");
    expect(slackCalls()[0][3]).toBe("admin");
  });

  it("frees the slot it cancels", async () => {
    const r = seed();
    await actions.changeReservationStatus(r.id, "cancelled");
    expect(db.reservedRanges("booth-1", "2026-07-16")).toEqual([]);
  });

  it("deletes without emailing anyone or telling Slack", async () => {
    const r = seed();
    const changed = await actions.changeReservationStatus(r.id, "deleted");

    expect(changed?.reservation.status).toBe("deleted");
    expect(changed?.email).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(slackCalls()).toHaveLength(0);
  });

  it("does not announce a confirm on one that was already confirmed", async () => {
    const r = seed("confirmed");
    await actions.changeReservationStatus(r.id, "confirmed");
    expect(slackCalls()).toHaveLength(0);
  });

  it("sends an edited body in place of the template", async () => {
    const r = seed();
    await actions.changeReservationStatus(r.id, "cancelled", "Sorry, Ada.");
    expect(send.mock.calls[0][0].html).toContain("Sorry, Ada.");
  });

  it("returns null for a missing reservation and tells nobody", async () => {
    seed();
    expect(await actions.changeReservationStatus("ghost", "cancelled")).toBe(
      null,
    );
    expect(send).not.toHaveBeenCalled();
    expect(slackCalls()).toHaveLength(0);
  });

  it("keeps the change and reports the email skipped when there is no address", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = seed("pending", { email: undefined });
    const changed = await actions.changeReservationStatus(r.id, "confirmed");
    expect(changed?.email).toBe("skipped");
    expect(db.getReservation(r.id)?.status).toBe("confirmed");
  });

  it("keeps the change and reports the email skipped while email is off", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const r = seed();
    const changed = await actions.changeReservationStatus(r.id, "cancelled");
    expect(changed?.email).toBe("skipped");
    expect(db.getReservation(r.id)?.status).toBe("cancelled");
  });

  it("keeps the change and reports a failure when Resend refuses or throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = seed("pending");
    send.mockResolvedValueOnce({ data: null, error: { message: "bounced" } });
    const refused = await actions.changeReservationStatus(
      first.id,
      "confirmed",
    );
    expect(refused?.email).toBe("failed");
    expect(db.getReservation(first.id)?.status).toBe("confirmed");

    send.mockRejectedValueOnce(new Error("network down"));
    const thrown = await actions.changeReservationStatus(first.id, "cancelled");
    expect(thrown?.email).toBe("failed");
    expect(db.getReservation(first.id)?.status).toBe("cancelled");
  });
});
