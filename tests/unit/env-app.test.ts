import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getContactFromEnv,
  optionalEnv,
  requireEnv,
  requireIntEnv,
} from "@/lib/env-app";

afterEach(() => vi.unstubAllEnvs());

describe("requireEnv", () => {
  it("returns the value when set", () => {
    vi.stubEnv("SOME_VAR", "hello");
    expect(requireEnv("SOME_VAR")).toBe("hello");
  });

  it("throws when unset or blank", () => {
    vi.stubEnv("SOME_VAR", "");
    expect(() => requireEnv("SOME_VAR")).toThrow(/SOME_VAR/);
    vi.stubEnv("SOME_VAR", "   ");
    expect(() => requireEnv("SOME_VAR")).toThrow(/SOME_VAR/);
  });
});

describe("requireIntEnv", () => {
  it("parses an integer", () => {
    vi.stubEnv("N", "42");
    expect(requireIntEnv("N")).toBe(42);
  });

  it("throws on a non-integer or missing value", () => {
    vi.stubEnv("N", "4.5");
    expect(() => requireIntEnv("N")).toThrow(/integer/);
    vi.stubEnv("N", "abc");
    expect(() => requireIntEnv("N")).toThrow(/integer/);
    vi.stubEnv("N", "");
    expect(() => requireIntEnv("N")).toThrow(/N/);
  });
});

describe("optionalEnv", () => {
  it("returns the trimmed value, or undefined when unset/blank", () => {
    vi.stubEnv("FLAG", "  on  ");
    expect(optionalEnv("FLAG")).toBe("on");
    vi.stubEnv("FLAG", "");
    expect(optionalEnv("FLAG")).toBeUndefined();
  });
});

describe("getContactFromEnv", () => {
  it("reads every required business var", () => {
    vi.stubEnv("EMAIL_SIGNOFF_NAME", "Alex");
    vi.stubEnv("BUSINESS_NAME", "Test Org");
    vi.stubEnv("BUSINESS_PHONE", "+000 1");
    vi.stubEnv("BUSINESS_EMAIL", "hi@test.co");
    vi.stubEnv("BUSINESS_WEBSITE_URL", "https://test.co");
    expect(getContactFromEnv()).toEqual({
      name: "Alex",
      org: "Test Org",
      phone: "+000 1",
      email: "hi@test.co",
      url: "https://test.co",
    });
  });

  it("throws when a required business var is missing", () => {
    vi.stubEnv("BUSINESS_NAME", "");
    expect(() => getContactFromEnv()).toThrow(/BUSINESS_NAME/);
  });
});
