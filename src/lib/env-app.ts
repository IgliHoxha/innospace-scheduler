// Vars are read lazily, at call time, so tests can stub them.
import type { ContactInfo } from "./types";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v == null || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

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

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function getContactFromEnv(): ContactInfo {
  return {
    name: requireEnv("EMAIL_SIGNOFF_NAME"),
    org: requireEnv("BUSINESS_NAME"),
    phone: requireEnv("BUSINESS_PHONE"),
    email: requireEnv("BUSINESS_EMAIL"),
    url: requireEnv("BUSINESS_WEBSITE_URL"),
  };
}
