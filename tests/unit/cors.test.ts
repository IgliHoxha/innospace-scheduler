import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOriginAllowed,
  isRequestOriginAllowed,
  requestOrigin,
  requireAllowedOrigin,
} from "@/lib/cors";

afterEach(() => vi.unstubAllEnvs());

describe("isOriginAllowed", () => {
  it("allows anything when ALLOWED_ORIGINS is unset (wildcard)", () => {
    expect(isOriginAllowed("https://anywhere.com")).toBe(true);
    expect(isOriginAllowed(null)).toBe(true);
  });

  it("restricts to the configured list, but can't enforce a null origin", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://a.com, https://b.com");
    expect(isOriginAllowed("https://a.com")).toBe(true);
    expect(isOriginAllowed("https://evil.com")).toBe(false);
    expect(isOriginAllowed(null)).toBe(true);
  });
});

describe("requestOrigin", () => {
  it("prefers the Origin header, falls back to the Referer's origin, else null", () => {
    expect(requestOrigin(new Headers({ origin: "https://a.com" }))).toBe(
      "https://a.com",
    );
    expect(
      requestOrigin(new Headers({ referer: "https://b.com/some/path" })),
    ).toBe("https://b.com");
    expect(requestOrigin(new Headers({ referer: "not a url" }))).toBeNull();
    expect(requestOrigin(new Headers())).toBeNull();
  });
});

describe("requireAllowedOrigin", () => {
  it("returns null (proceed) when ALLOWED_ORIGINS is unset (wildcard)", () => {
    expect(
      requireAllowedOrigin(new Headers({ origin: "https://evil.com" })),
    ).toBeNull();
  });

  it("returns null (proceed) for an allowed or missing origin", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://a.com");
    expect(
      requireAllowedOrigin(new Headers({ origin: "https://a.com" })),
    ).toBeNull();
    // A missing origin can't be enforced, so it passes.
    expect(requireAllowedOrigin(new Headers())).toBeNull();
  });

  it("returns a 403 for a disallowed origin under a restricted list", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://a.com");
    const res = requireAllowedOrigin(
      new Headers({ origin: "https://evil.com" }),
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ ok: false, error: "Forbidden" });
  });
});

describe("same-origin requests", () => {
  // Regression guard: every page calls this app's own API from the host it is
  // served on. ALLOWED_ORIGINS describes *other* sites, so the app must never
  // have to list itself there or it 403s every one of its own mutations.
  const app = new Headers({
    origin: "https://scheduler.example.com",
    host: "scheduler.example.com",
  });

  it("passes even when the app's own origin is not on the allowlist", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://site.example.com");
    expect(isRequestOriginAllowed(app)).toBe(true);
    expect(requireAllowedOrigin(app)).toBeNull();
  });

  it("matches on host only, so a scheme flipped by the proxy still passes", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://site.example.com");
    const h = new Headers({
      origin: "https://scheduler.example.com",
      referer: "https://scheduler.example.com/dashboard",
      host: "scheduler.example.com",
    });
    expect(isRequestOriginAllowed(h)).toBe(true);
  });

  it("still blocks a different host, and a look-alike sub-domain", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://site.example.com");
    for (const origin of [
      "https://evil.test",
      "https://scheduler.example.com.evil.test",
    ]) {
      expect(
        isRequestOriginAllowed(
          new Headers({ origin, host: "scheduler.example.com" }),
        ),
      ).toBe(false);
    }
  });

  it("falls back to the allowlist when there is no Host header", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://site.example.com");
    expect(
      isRequestOriginAllowed(
        new Headers({ origin: "https://site.example.com" }),
      ),
    ).toBe(true);
    expect(
      isRequestOriginAllowed(new Headers({ origin: "https://evil.test" })),
    ).toBe(false);
  });

  it("allows a request carrying no origin at all", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://site.example.com");
    expect(isRequestOriginAllowed(new Headers({ host: "x.example.com" }))).toBe(
      true,
    );
  });
});
