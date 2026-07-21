import { afterEach, describe, expect, it, vi } from "vitest";
import {
  corsHeaders,
  isOriginAllowed,
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

describe("corsHeaders", () => {
  it("always sets method/header/vary, and echoes an allowed origin", () => {
    const h = corsHeaders("https://a.com");
    expect(h["Access-Control-Allow-Methods"]).toContain("POST");
    expect(h["Access-Control-Allow-Headers"]).toBe("Content-Type");
    expect(h["Vary"]).toBe("Origin");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://a.com"); // wildcard default
  });

  it("echoes an allowed origin under a restricted list", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://a.com");
    expect(corsHeaders("https://a.com")["Access-Control-Allow-Origin"]).toBe(
      "https://a.com",
    );
  });

  it("omits Allow-Origin for a disallowed origin under a restricted list", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://a.com");
    expect(
      corsHeaders("https://evil.com")["Access-Control-Allow-Origin"],
    ).toBeUndefined();
  });
});
