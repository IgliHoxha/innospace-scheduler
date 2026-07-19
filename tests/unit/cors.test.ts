// cors.ts is currently unused by any route, but it's part of the lib surface.
import { afterEach, describe, expect, it, vi } from "vitest";
import { corsHeaders, isOriginAllowed, requestOrigin } from "@/lib/cors";

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
