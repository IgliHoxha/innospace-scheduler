// Cloudflare Turnstile: proves a booking came from a browser, not a script.
// Both keys are optional feature-flags (like RESEND_API_KEY): with either unset
// the check is skipped entirely, so dev and the test suite need no Cloudflare.
import { optionalEnv } from "./env-app";

const VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify" as const;

/** Is Turnstile configured? Both halves are needed: a widget nobody verifies is theatre. */
export function turnstileEnabled(): boolean {
  return (
    !!optionalEnv("TURNSTILE_SITE_KEY") && !!optionalEnv("TURNSTILE_SECRET_KEY")
  );
}

/**
 * The public widget key, and only when the pair is complete. Half a
 * configuration renders no widget at all, so the form can never show a check
 * that the route isn't enforcing.
 */
export function turnstileSiteKey(): string | undefined {
  return turnstileEnabled() ? optionalEnv("TURNSTILE_SITE_KEY") : undefined;
}

/**
 * Verify a widget token with Cloudflare. Fails closed: a malformed answer, a
 * non-200, or a network error all count as "not verified", so an attacker can't
 * get in by making the check itself fail.
 */
export async function verifyTurnstile(
  token: unknown,
  ip?: string,
): Promise<boolean> {
  const secret = optionalEnv("TURNSTILE_SECRET_KEY");
  if (!secret) return true; // switched off: nothing to verify against
  if (typeof token !== "string" || !token) return false;

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
