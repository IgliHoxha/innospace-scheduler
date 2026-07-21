// Central env access. Required vars throw at read time if unset/blank (no code
// defaults): configuration must be explicit. Read lazily (at call time), so a
// missing var only surfaces when actually used and tests can vi.stubEnv it.
//
// The only optional vars are the three feature-flags (RESEND_API_KEY,
// TURNSTILE_SECRET_KEY, ALLOWED_ORIGINS): unset simply turns that feature off.
import type { ContactInfo } from "./types";

/** A required string env var. Throws if unset or blank. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v == null || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

/** A required integer env var. Throws if unset, blank, or not an integer. */
export function requireIntEnv(name: string): number {
  const raw = requireEnv(name);
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(
      `Env var ${name} must be an integer, got: ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

/** An optional (feature-flag) env var: undefined when unset or blank. */
export function optionalEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Business contact block for emails. Every field is required (no defaults). */
export function getContactFromEnv(): ContactInfo {
  return {
    name: requireEnv("EMAIL_SIGNOFF_NAME"),
    org: requireEnv("BUSINESS_NAME"),
    phone: requireEnv("BUSINESS_PHONE"),
    email: requireEnv("BUSINESS_EMAIL"),
    url: requireEnv("BUSINESS_WEBSITE_URL"),
  };
}
