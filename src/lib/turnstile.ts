// Turnstile proves a booking came from a browser; with either key unset the check is skipped.
import { optionalEnv } from "./env-app";

const VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify" as const;

/** Is Turnstile configured? Both halves are needed: a widget nobody verifies is theatre. */
export function turnstileEnabled(): boolean {
  return (
    !!optionalEnv("TURNSTILE_SITE_KEY") && !!optionalEnv("TURNSTILE_SECRET_KEY")
  );
}

/** The public widget key, only when the pair is complete, so the form never shows an unenforced check. */
export function turnstileSiteKey(): string | undefined {
  return turnstileEnabled() ? optionalEnv("TURNSTILE_SITE_KEY") : undefined;
}

/** Verify a token with Cloudflare, failing closed: any error counts as not verified. */
export async function verifyTurnstile(
  token: unknown,
  ip?: string,
): Promise<boolean> {
  const secret = optionalEnv("TURNSTILE_SECRET_KEY");
  if (!secret) return true; // switched off: nothing to verify against
  // Logged because it never reaches siteverify, where it would otherwise look like nobody booking.
  if (typeof token !== "string" || !token) {
    console.warn(
      "[turnstile] booking rejected: no widget token in the request",
    );
    return false;
  }

  const form = new URLSearchParams({ secret, response: token });
  // Binds the token to the client that solved it, so a stolen one is less useful.
  if (ip && ip !== "unknown") form.set("remoteip", ip);

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) {
      console.error("[turnstile] siteverify HTTP", res.status);
      return false;
    }
    const data = (await res.json()) as { success?: unknown };
    return data?.success === true;
  } catch (err) {
    console.error("[turnstile] siteverify failed:", err);
    return false;
  }
}
