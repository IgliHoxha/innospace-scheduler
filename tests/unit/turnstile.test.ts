// turnstile.ts is currently unused by any route, but it's part of the lib surface.
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/lib/turnstile";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("verifyTurnstile", () => {
  it("is skipped (and passes) when no secret is configured", async () => {
    expect(await verifyTurnstile("any")).toEqual({ ok: true, skipped: true });
  });

  it("fails a missing token once the feature is enabled", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sk");
    expect(await verifyTurnstile(undefined)).toEqual({
      ok: false,
      errors: ["missing-input-response"],
    });
  });

  it("passes when Cloudflare returns success", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sk");
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await verifyTurnstile("tok", "1.2.3.4")).toEqual({
      ok: true,
      errors: undefined,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("surfaces Cloudflare's error codes on failure", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sk");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      }),
    );
    expect(await verifyTurnstile("tok")).toEqual({
      ok: false,
      errors: ["invalid-input-response"],
    });
  });

  it("fails closed when the verify request throws", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sk");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await verifyTurnstile("tok")).toEqual({
      ok: false,
      errors: ["verify-request-failed"],
    });
  });
});
