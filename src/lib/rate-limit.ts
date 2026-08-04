// In-memory brute-force guard, viable because one long-lived Fly machine serves everything.

import { optionalEnv, requireIntEnv } from "./env-app";
import { safeEqual } from "./auth";

type Bucket = {
  fails: number; // consecutive failures in the current window
  lockouts: number; // how many times this key has been locked out (escalation)
  blockedUntil: number; // epoch ms; 0 when not blocked
  banned: boolean; // permanent block (only used by the IP bucket)
  seen: number; // epoch ms of last activity (for pruning)
};

const buckets = new Map<string, Bucket>();

// Forget idle records after this long so the Map can't grow unbounded.
const IDLE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Sweeping every key on every request is wasted work; once a minute forgets idle records just as well.
const PRUNE_EVERY_MS = 60 * 1000;
let lastPrunedAt = 0;

// Hard ceiling, since a spoofed address header mints a key: ~10k buckets is ~2MB on a 256mb machine.
const MAX_BUCKETS = 10_000;

/** Per-bucket policy. `maxLockouts: null` means "never ban". */
type Policy = {
  maxAttempts: number;
  blockBaseSeconds: number;
  maxLockouts: number | null;
};

function posIntEnv(name: string): number {
  const n = requireIntEnv(name);
  if (n <= 0) throw new Error(`${name} must be a positive integer.`);
  return n;
}

/** Per-account: strict, but never a permanent ban (never lock the admin out for good). */
function accountPolicy(): Policy {
  return {
    maxAttempts: posIntEnv("LOGIN_MAX_ATTEMPTS"),
    blockBaseSeconds: posIntEnv("LOGIN_BLOCK_SECONDS"),
    maxLockouts: null,
  };
}

/** Per-IP: lenient threshold (shared office IP), bans only under sustained abuse. */
function ipPolicy(): Policy {
  return {
    maxAttempts: posIntEnv("LOGIN_IP_MAX_ATTEMPTS"),
    blockBaseSeconds: posIntEnv("LOGIN_IP_BLOCK_SECONDS"),
    maxLockouts: posIntEnv("LOGIN_MAX_LOCKOUTS"),
  };
}

/** The login thresholds without banning: a ban would DoS the shared office IP everyone books from. */
function bookingPolicy(): Policy {
  return {
    maxAttempts: posIntEnv("LOGIN_IP_MAX_ATTEMPTS"),
    blockBaseSeconds: posIntEnv("LOGIN_IP_BLOCK_SECONDS"),
    maxLockouts: null,
  };
}

export type RateStatus = {
  blocked: boolean;
  banned: boolean;
  retryAfterSeconds: number;
};

const OK: RateStatus = { blocked: false, banned: false, retryAfterSeconds: 0 };

function prune(now: number) {
  if (now - lastPrunedAt < PRUNE_EVERY_MS) return;
  lastPrunedAt = now;
  for (const [key, b] of buckets) {
    if (now - b.seen > IDLE_TTL_MS && b.blockedUntil <= now && !b.banned) {
      buckets.delete(key);
    }
  }
}

/** Last resort when the cap is hit: drop the least recently seen, sparing live blocks while any spare. */
function evictOldest(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  // By `seen`, not Map order: Map order is first insert, so a busy old key would go before an idle new one.
  const byAge = [...buckets.entries()].sort((a, b) => a[1].seen - b[1].seen);
  for (const [key, b] of byAge) {
    if (buckets.size <= MAX_BUCKETS) return;
    if (!b.banned && b.blockedUntil <= now) buckets.delete(key);
  }
  // Nothing but live blocks left, so the oldest of those goes rather than let the Map grow.
  for (const [key] of byAge) {
    if (buckets.size <= MAX_BUCKETS) return;
    buckets.delete(key);
  }
}

/** Read-only status of a single bucket. */
function peek(key: string): RateStatus {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b) return OK;
  if (b.banned) return { blocked: true, banned: true, retryAfterSeconds: 0 };
  if (b.blockedUntil > now) {
    return {
      blocked: true,
      banned: false,
      retryAfterSeconds: Math.ceil((b.blockedUntil - now) / 1000),
    };
  }
  return OK;
}

/** Record a failure against a single bucket and return its resulting status. */
function hit(key: string, policy: Policy): RateStatus {
  const now = Date.now();
  prune(now);
  evictOldest(now);
  const b: Bucket = buckets.get(key) ?? {
    fails: 0,
    lockouts: 0,
    blockedUntil: 0,
    banned: false,
    seen: now,
  };
  b.seen = now;

  if (b.banned) {
    buckets.set(key, b);
    return { blocked: true, banned: true, retryAfterSeconds: 0 };
  }
  // Already serving a lockout - report remaining time without escalating.
  if (b.blockedUntil > now) {
    buckets.set(key, b);
    return {
      blocked: true,
      banned: false,
      retryAfterSeconds: Math.ceil((b.blockedUntil - now) / 1000),
    };
  }

  b.fails += 1;
  if (b.fails >= policy.maxAttempts) {
    b.lockouts += 1;
    b.fails = 0; // reset the window; the lockout is the penalty now

    if (policy.maxLockouts !== null && b.lockouts > policy.maxLockouts) {
      b.banned = true;
      b.blockedUntil = Number.MAX_SAFE_INTEGER;
      buckets.set(key, b);
      return { blocked: true, banned: true, retryAfterSeconds: 0 };
    }

    const seconds = policy.blockBaseSeconds * b.lockouts; // 60s, 120s, 180s, …
    b.blockedUntil = now + seconds * 1000;
    buckets.set(key, b);
    return { blocked: true, banned: false, retryAfterSeconds: seconds };
  }

  buckets.set(key, b);
  return OK;
}

/** Combine two statuses into the strongest block (ban > longer lockout > ok). */
function strongest(a: RateStatus, b: RateStatus): RateStatus {
  if (a.banned) return a;
  if (b.banned) return b;
  if (!a.blocked && !b.blocked) return OK;
  return a.retryAfterSeconds >= b.retryAfterSeconds ? a : b;
}

// Namespaced keys so an account can never collide with an IP of the same string.
function acctKey(loginId: string): string {
  return `acct:${loginId.trim().toLowerCase()}`;
}
function ipKey(ip: string): string {
  return `ip:${ip}`;
}
// Own namespace so booking throttling can never lock the admin's login bucket.
function bookingKey(ip: string): string {
  return `booking:${ip}`;
}

/** Is this client currently blocked by either bucket? Read-only. */
export function checkLoginBlocked(ip: string, loginId: string): RateStatus {
  return strongest(peek(ipKey(ip)), peek(acctKey(loginId)));
}

/** Record a failed login against both the account and the IP buckets. */
export function registerLoginFailure(ip: string, loginId: string): RateStatus {
  // Hit both (no short-circuit) so each bucket's counter advances every attempt.
  const ipStatus = hit(ipKey(ip), ipPolicy());
  const acctStatus = hit(acctKey(loginId), accountPolicy());
  return strongest(ipStatus, acctStatus);
}

/** Successful login - clear both buckets for this client. */
export function registerLoginSuccess(ip: string, loginId: string): void {
  buckets.delete(ipKey(ip));
  buckets.delete(acctKey(loginId));
}

/** Is this IP currently throttled from booking? Read-only. */
export function checkBookingBlocked(ip: string): RateStatus {
  return peek(bookingKey(ip));
}

/** Record a booking attempt against the per-IP booking throttle. */
export function registerBooking(ip: string): RateStatus {
  return hit(bookingKey(ip), bookingPolicy());
}

// Set by a Cloudflare Transform Rule on every proxied request; absent on anything reaching Fly directly.
const PROOF_HEADER = "x-origin-proof";

// A shape guard, not a validator: it only stops a junk header becoming an arbitrarily long Map key.
const IP_RE = /^[0-9a-f:.]{3,45}$/i;

function asIp(value: string | null | undefined): string {
  const ip = value?.trim() ?? "";
  return IP_RE.test(ip) ? ip : "";
}

/** Best-effort client IP; always a string, so unknowns share one bucket. */
export function clientKey(headers: Headers): string {
  // fly-client-ip comes from the real TCP peer, so it is the one value a direct caller cannot choose.
  const peer = asIp(headers.get("fly-client-ip"));
  const secret = optionalEnv("TRUSTED_PROXY_SECRET");
  // No proof means this never went through Cloudflare, so the address headers it carries are its own invention.
  if (secret && !safeEqual(headers.get(PROOF_HEADER) ?? "", secret)) {
    return peer || "unknown";
  }

  return (
    asIp(headers.get("cf-connecting-ip")) ||
    peer ||
    asIp(headers.get("x-forwarded-for")?.split(",")[0]) ||
    asIp(headers.get("x-real-ip")) ||
    "unknown"
  );
}
