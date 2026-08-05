// Does the domain accept mail? Server-only (node:dns); guest.ts holds the rules.
import { promises as dns } from "node:dns";

const NO_MAIL = "That email domain doesn't accept mail. Please check it.";
const DISPOSABLE_MSG =
  "Please use a permanent email address so we can reach you about your booking.";

// Throwaway providers, deliberately short: a long list ages badly.
const DISPOSABLE = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "maildrop.cc",
  "sharklasers.com",
  "temp-mail.org",
  "tempmail.com",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
]);

// Cached per domain: bookings cluster, and DNS outlives one request.
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { accepts: boolean; at: number }>();

export type EmailCheck = { ok: true } | { ok: false; error: string };

/** Test seam: drops the memoised DNS answers. */
export function resetEmailVerifyCache(): void {
  cache.clear();
}

/** null when DNS could not answer: only "no such domain" says false. */
async function domainAcceptsMail(domain: string): Promise<boolean | null> {
  try {
    const mx = await dns.resolveMx(domain);
    // A published MX settles it; "." is RFC 7505's null MX, refusing mail.
    if (mx.length > 0) return mx.some((r) => r.exchange && r.exchange !== ".");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND") return false; // the domain does not exist
    if (code !== "ENODATA") return null; // timeout, SERVFAIL: unknown
  }

  // No MX is still legal: RFC 5321 falls back to the domain's A/AAAA record.
  try {
    const a = await dns.resolve(domain);
    return a.length > 0;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? false : null;
  }
}

/** Deliverability gate for a syntactically valid address (see guest.ts first). */
export async function checkEmailDeliverable(
  email: string,
): Promise<EmailCheck> {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  if (!domain) return { ok: false, error: NO_MAIL };
  if (DISPOSABLE.has(domain)) return { ok: false, error: DISPOSABLE_MSG };

  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.accepts ? { ok: true } : { ok: false, error: NO_MAIL };
  }

  const accepts = await domainAcceptsMail(domain);
  if (accepts === null) return { ok: true }; // DNS unreachable: never block on it
  cache.set(domain, { accepts, at: Date.now() });
  return accepts ? { ok: true } : { ok: false, error: NO_MAIL };
}
