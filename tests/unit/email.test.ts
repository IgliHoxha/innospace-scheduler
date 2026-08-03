import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Reservation } from "@/lib/types";
import { verifyCancelToken } from "@/lib/auth";

// Resend is stubbed at class level; `send` is shared so the lazy singleton stays observable.
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
  it("points at the versioned email asset, not the site logo", async () => {
    const html = await reservationHtml();
    expect(html).toContain(
      '<img src="https://scheduler.example.test/logo-mark.svg?v=6"',
    );
    // Gmail caches per source URL, so the version must survive any edit here.
    expect(html).not.toContain('/logo.svg"');
  });

  it("does not double the slash when APP_BASE_URL has a trailing one", async () => {
    vi.stubEnv("APP_BASE_URL", "https://staging.example.com/");
    expect(await reservationHtml()).toContain(
      'src="https://staging.example.com/logo-mark.svg?v=6"',
    );
  });

  it("carries width/height attributes so CSS-stripping clients size it", async () => {
    const html = await reservationHtml();
    expect(html).toContain('width="34" height="32"');
    expect(html).toContain("width:34px;height:32px");
  });

  it("falls back to the org name as alt text where the image is blocked", async () => {
    vi.stubEnv("BUSINESS_NAME", "Innospace Tirana");
    expect(await reservationHtml()).toContain('alt="Innospace Tirana"');
  });

  // Gmail can't recolour inside an image, so only the mark ships as artwork, teal on either ground.
  it("ships a teal-only mark asset with no wordmark and no media query", () => {
    const svg = readFileSync(
      join(process.cwd(), "public", "logo-mark.svg"),
      "utf8",
    );
    expect(svg).toContain(".cls-1{fill:#25bdad;}");
    expect(svg).not.toContain("cls-2");
    expect(svg).not.toContain("prefers-color-scheme");
  });

  // The wordmark is HTML text inked neutral so dark mode inverts it; flat spans, never a table.
  it("builds the header without a table, so the card is not split", async () => {
    const html = await reservationHtml();
    expect(html).not.toContain("<table");
    expect(html).toContain("display:inline-block;vertical-align:middle");
  });

  it("renders the wordmark as HTML text in neutral ink, not as artwork", async () => {
    const html = await reservationHtml();
    expect(html).toContain('<span style="font-weight:700">inno</span>');
    expect(html).toContain('<span style="font-weight:400">space</span>');
    expect(html).toContain("color:#000000");
    expect(html).toContain(">TIRANA<");
  });

  // The site asset stays tight and transparent: no panel, no adaptive rule.
  it("keeps the site logo a plain black wordmark", () => {
    const svg = readFileSync(join(process.cwd(), "public", "logo.svg"), "utf8");
    expect(svg).toContain(".cls-2{fill:#000000;}");
    expect(svg).not.toContain("prefers-color-scheme");
    expect(svg).not.toContain('class="bg"');
  });

  it("pins the site to a light colour scheme so native controls stay light", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "app", "globals.css"),
      "utf8",
    );
    expect(css).toMatch(/color-scheme:\s*light/);
  });
});

describe("body copy colour", () => {
  // Dark-mode inversion keeps hue and flips lightness, so the old plum ink came back pink.
  it("inks paragraphs with a neutral black, never the brand plum", async () => {
    const html = await reservationHtml();
    expect(html).toContain("color:#000000;font-size:14px");
    expect(html).not.toContain("#524552");
  });

  it("keeps the saturated brand colour on links, which inverts cleanly", async () => {
    await email.sendReservationEmail(
      RESERVATION,
      "confirmed",
      "See https://example.com for details",
    );
    expect(htmlOf()).toContain(
      '<a href="https://example.com" style="color:#25bdad"',
    );
  });
});

describe("cancel link", () => {
  // It only renders while the slot is still ahead, so pin "now" before it.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-16T08:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  const tokenIn = (html: string) =>
    decodeURIComponent(/cancel\?token=([^"]+)/.exec(html)![1]);

  it("adds a cancel link to a confirmation", async () => {
    const html = await reservationHtml();
    expect(html).toContain("https://scheduler.example.test/cancel?token=");
    expect(html).toContain("Cancel this reservation");
  });

  it("signs the link for that one reservation", async () => {
    expect(verifyCancelToken(tokenIn(await reservationHtml()))).toBe("rs_1");
  });

  it("adds it to a pending request too: the slot is held, so it can be released", async () => {
    await email.sendReservationEmail(RESERVATION, "pending");
    expect(verifyCancelToken(tokenIn(htmlOf()))).toBe("rs_1");
  });

  it("omits it on a cancellation: there is nothing left to cancel", async () => {
    await email.sendReservationEmail(RESERVATION, "cancelled");
    expect(htmlOf()).not.toContain("/cancel?token=");
  });

  it("omits it once the reservation has already ended", async () => {
    vi.setSystemTime(new Date("2026-07-16T11:01:00"));
    expect(await reservationHtml()).not.toContain("/cancel?token=");
  });

  // Same inversion rule as the body copy: neutral ink, never the plum-tinted grey.
  it("inks the fine print neutral", async () => {
    expect(await reservationHtml()).toContain(
      'color:#767676;font-size:12px">Only you have this link',
    );
  });

  it("inks the button label neutral", async () => {
    expect(await reservationHtml()).toContain(
      "color:#000000;text-decoration:none",
    );
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

describe("linkified body", () => {
  it("links a bare email address in the brand colour, not Gmail's blue", async () => {
    await email.sendReservationEmail(
      RESERVATION,
      "confirmed",
      "Email: info@innospacetirana.com",
    );
    expect(htmlOf()).toContain(
      '<a href="mailto:info@innospacetirana.com" style="color:#25bdad">info@innospacetirana.com</a>',
    );
  });

  it("gives URLs and addresses the same colour", async () => {
    await email.sendReservationEmail(
      RESERVATION,
      "confirmed",
      "See https://maps.google.com/?q=x or mail info@innospacetirana.com",
    );
    const html = htmlOf();
    const colours = [
      ...html.matchAll(/<a href="[^"]*" style="color:(#[0-9a-f]{6})"/g),
    ].map((m) => m[1]);
    expect(colours.length).toBe(2);
    expect(new Set(colours).size).toBe(1);
  });

  it("leaves trailing sentence punctuation outside the link", async () => {
    await email.sendReservationEmail(
      RESERVATION,
      "confirmed",
      "Write to info@innospacetirana.com.",
    );
    expect(htmlOf()).toContain(">info@innospacetirana.com</a>.");
  });

  it("links a phone number as tel: in the brand colour, not the client's blue", async () => {
    await email.sendReservationEmail(
      RESERVATION,
      "confirmed",
      "Phone: +355 69 219 2666",
    );
    expect(htmlOf()).toContain(
      '<a href="tel:+355692192666" style="color:#25bdad">+355 69 219 2666</a>',
    );
  });

  it("leaves years, prices and street numbers alone", async () => {
    await email.sendReservationEmail(
      RESERVATION,
      "confirmed",
      "15 EUR per day on 4 August 2026 at Nd 10, H 5, Apt 1",
    );
    expect(htmlOf()).not.toContain("tel:");
  });

  it("does not mistake the + separators in a maps URL for a phone number", async () => {
    await email.sendReservationEmail(
      RESERVATION,
      "confirmed",
      "https://maps.google.com/?q=Rr.+Pjeter+Bogdani+Tirana",
    );
    const html = htmlOf();
    expect(html).not.toContain("tel:");
    expect(html).toContain(
      'href="https://maps.google.com/?q=Rr.+Pjeter+Bogdani+Tirana"',
    );
  });

  it("treats a URL containing an @ as one URL, not a stray address", async () => {
    await email.sendReservationEmail(
      RESERVATION,
      "confirmed",
      "Open https://example.com/p?e=a@b.com now",
    );
    const html = htmlOf();
    expect(html).toContain('href="https://example.com/p?e=a@b.com"');
    expect(html).not.toContain("mailto:");
  });
});

describe("send outcome", () => {
  afterEach(() => send.mockResolvedValue({ data: null, error: null }));

  it("reports 'sent' when Resend accepts it", async () => {
    await expect(
      email.sendReservationEmail(RESERVATION, "confirmed"),
    ).resolves.toBe("sent");
  });

  // The SDK reports refusals in the resolved value, so catching alone would save a silent booking.
  it("reports 'failed' when Resend refuses the address", async () => {
    send.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "Invalid `to` field" },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      email.sendReservationEmail(RESERVATION, "confirmed"),
    ).resolves.toBe("failed");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("reports 'failed' when the call throws", async () => {
    send.mockRejectedValueOnce(new Error("ECONNRESET"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      email.sendReservationEmail(RESERVATION, "confirmed"),
    ).resolves.toBe("failed");
    err.mockRestore();
  });

  it("reports 'skipped', not 'failed', when there is no API key", async () => {
    vi.resetModules();
    vi.stubEnv("RESEND_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fresh = await import("@/lib/email");
    await expect(
      fresh.sendReservationEmail(RESERVATION, "confirmed"),
    ).resolves.toBe("skipped");
    warn.mockRestore();
  });

  it("reports 'skipped' when the reservation carries no address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      email.sendReservationEmail(
        { ...RESERVATION, email: undefined },
        "confirmed",
      ),
    ).resolves.toBe("skipped");
    warn.mockRestore();
  });
});
