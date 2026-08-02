import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Reservation } from "@/lib/types";

// Resend is stubbed at the class level so no request ever leaves the process;
// `send` is shared across instances so the lazy singleton is still observable.
const send = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

type Email = typeof import("@/lib/email");
let email: Email;

const RESERVATION: Reservation = {
  id: "rs_1",
  fullName: "Ada",
  email: "ada@example.com",
  boothId: "booth-1",
  startsAt: "2026-07-16T09:30",
  endsAt: "2026-07-16T11:00",
  status: "confirmed",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
};

const htmlOf = (call: number = 0) => send.mock.calls[call][0].html as string;

async function reservationHtml(): Promise<string> {
  await email.sendReservationEmail(RESERVATION, "confirmed");
  return htmlOf();
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  email = await import("@/lib/email");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("email logo", () => {
  it("points at logo.svg under APP_BASE_URL", async () => {
    expect(await reservationHtml()).toContain(
      '<img src="https://scheduler.example.test/logo.svg"',
    );
  });

  it("does not double the slash when APP_BASE_URL has a trailing one", async () => {
    vi.stubEnv("APP_BASE_URL", "https://staging.example.com/");
    expect(await reservationHtml()).toContain(
      'src="https://staging.example.com/logo.svg"',
    );
  });

  it("carries width/height attributes so CSS-stripping clients size it", async () => {
    const html = await reservationHtml();
    expect(html).toContain('width="126" height="30"');
    expect(html).toContain("height:30px;width:126px");
  });

  it("falls back to the org name as alt text where SVG is blocked", async () => {
    vi.stubEnv("BUSINESS_NAME", "Innospace Tirana");
    expect(await reservationHtml()).toContain('alt="Innospace Tirana"');
  });

  // The invite and reset mails share the same shell, so the logo must follow.
  it("appears in the invite and password-reset mails too", async () => {
    await email.sendInviteEmail("ada@example.com", "tok_invite");
    await email.sendPasswordResetEmail("ada@example.com", "tok_reset");
    expect(htmlOf(0)).toContain("https://scheduler.example.test/logo.svg");
    expect(htmlOf(1)).toContain("https://scheduler.example.test/logo.svg");
  });

  // Guards the assets themselves: the mail links to the same black wordmark the
  // site UI renders, with logo-white.svg as its dark-background counterpart.
  it("ships logo.svg with a black wordmark and logo-white.svg with a white one", () => {
    const read = (name: string) =>
      readFileSync(join(process.cwd(), "public", name), "utf8");
    expect(read("logo.svg")).toContain(".cls-2{fill:#000000;}");
    expect(read("logo-white.svg")).toContain(".cls-2{fill:#fff;}");
  });
});

describe("send guards", () => {
  it("skips sending when RESEND_API_KEY is unset", async () => {
    vi.resetModules();
    vi.stubEnv("RESEND_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("@/lib/email");
    await mod.sendReservationEmail(RESERVATION, "confirmed");
    expect(send).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips a reservation with no email address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await email.sendReservationEmail(
      { ...RESERVATION, email: undefined },
      "cancelled",
    );
    expect(send).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
