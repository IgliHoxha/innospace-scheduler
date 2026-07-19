/**
 * Cloudflare Turnstile verification, feature-flagged by TURNSTILE_SECRET_KEY:
 * unset -> skipped ({ ok, skipped }); set -> a missing/invalid token is rejected.
 */
const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = {
  ok: boolean;
  skipped?: boolean;
  errors?: string[];
};

export async function verifyTurnstile(
  token: string | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: true, skipped: true };

  if (!token) return { ok: false, errors: ["missing-input-response"] };

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (remoteIp) form.set("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
    const data = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };
    return { ok: !!data.success, errors: data["error-codes"] };
  } catch (err) {
    console.error("[turnstile] verify request failed:", err);
    return { ok: false, errors: ["verify-request-failed"] };
  }
}
