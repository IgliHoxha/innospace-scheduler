import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  turnstileEnabled,
  turnstileSiteKey,
  verifyTurnstile,
} from "@/lib/turnstile";

// Never let a test reach Cloudflare: every call goes through this stub.
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const siteverifyOk = (success: boolean) =>
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ success }),
  });

const bothKeys = () => {
  vi.stubEnv("TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
};

describe("turnstile configuration", () => {
  it("is off when neither key is set (the dev and test default)", () => {
    expect(turnstileEnabled()).toBe(false);
    expect(turnstileSiteKey()).toBeUndefined();
  });

  it("stays off with only half the pair: a widget nobody verifies is theatre", () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site");
    expect(turnstileEnabled()).toBe(false);
    vi.unstubAllEnvs();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    expect(turnstileEnabled()).toBe(false);
  });

  // Otherwise the form would render a check the route is not enforcing.
  it("withholds the site key until the secret is set too", () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site");
    expect(turnstileSiteKey()).toBeUndefined();
  });

  it("is on with both", () => {
    bothKeys();
    expect(turnstileEnabled()).toBe(true);
    expect(turnstileSiteKey()).toBe("1x00000000000000000000AA");
  });
});

describe("verifyTurnstile", () => {
  it("passes everything through untouched when switched off", async () => {
    await expect(verifyTurnstile(undefined)).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a token Cloudflare confirms", async () => {
    bothKeys();
    siteverifyOk(true);
    await expect(verifyTurnstile("tok", "1.2.3.4")).resolves.toBe(true);
  });

  it("rejects a token Cloudflare denies", async () => {
    bothKeys();
    siteverifyOk(false);
    await expect(verifyTurnstile("tok")).resolves.toBe(false);
  });

  it("posts the secret, the token and the client IP", async () => {
    bothKeys();
    siteverifyOk(true);
    await verifyTurnstile("tok", "1.2.3.4");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(init.method).toBe("POST");
    const sent = new URLSearchParams(init.body as URLSearchParams);
    expect(sent.get("secret")).toBe("1x0000000000000000000000000000000AA");
    expect(sent.get("response")).toBe("tok");
    expect(sent.get("remoteip")).toBe("1.2.3.4");
  });

  it("omits remoteip when the client IP is unknown", async () => {
    bothKeys();
    siteverifyOk(true);
    await verifyTurnstile("tok", "unknown");
    const sent = new URLSearchParams(
      fetchMock.mock.calls[0][1].body as URLSearchParams,
    );
    expect(sent.has("remoteip")).toBe(false);
  });

  it("rejects a missing or non-string token without calling out", async () => {
    bothKeys();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of [undefined, "", null, 42, { t: "x" }]) {
      await expect(verifyTurnstile(bad)).resolves.toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    // Logged every time: this path never reaches Cloudflare, so it is invisible in analytics.
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  // Fails closed: an attacker must not get in by breaking the check itself.
  it("rejects on a non-200 from Cloudflare", async () => {
    bothKeys();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(verifyTurnstile("tok")).resolves.toBe(false);
    err.mockRestore();
  });

  it("rejects on a network error", async () => {
    bothKeys();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // A plain stub, not vi.fn(): a tracked rejection resurfaces as an unhandled error.
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNRESET")));
    await expect(verifyTurnstile("tok")).resolves.toBe(false);
    err.mockRestore();
  });

  it("rejects a malformed body (success must be exactly true)", async () => {
    bothKeys();
    for (const body of [{}, { success: "true" }, { success: 1 }, null]) {
      fetchMock.mockResolvedValue({ ok: true, json: async () => body });
      await expect(verifyTurnstile("tok")).resolves.toBe(false);
    }
  });
});
