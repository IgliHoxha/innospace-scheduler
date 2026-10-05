// In-memory guard, viable because one long-lived Fly machine serves everything.

import { optionalEnv, requireIntEnv } from "./env-app";
import { safeEqual } from "./auth";

type Bucket = {
  fails: number; // consecutive failures in the current window
  lockouts: number;
  blockedUntil: number; // epoch ms; 0 when not blocked
  banned: boolean; // permanent block (only used by the IP bucket)
  seen: number; // epoch ms of last activity (for pruning)
};

const buckets = new Map<string, Bucket>();

// Forget idle records after this long so the Map can't grow unbounded.
const IDLE_TTL_MS = 60 * 60 * 1000;

// Sweeping on every request is wasted work; once a minute is enough.
const PRUNE_EVERY_MS = 60 * 1000;
let lastPrunedAt = 0;

// A spoofed address header mints a key, so cap it: ~10k buckets is ~2MB.
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

/** Per-account: strict, but never a permanent ban on the admin. */
function accountPolicy(): Policy {
  return {
    maxAttempts: posIntEnv("LOGIN_MAX_ATTEMPTS"),
    blockBaseSeconds: posIntEnv("LOGIN_BLOCK_SECONDS"),
    maxLockouts: null,
  };
}

/** Per-IP: lenient, as an office shares one IP; bans only sustained abuse. */
function ipPolicy(): Policy {
  return {
    maxAttempts: posIntEnv("LOGIN_IP_MAX_ATTEMPTS"),
    blockBaseSeconds: posIntEnv("LOGIN_IP_BLOCK_SECONDS"),
    maxLockouts: posIntEnv("LOGIN_MAX_LOCKOUTS"),
  };
}

/** Login thresholds without banning: a ban would DoS the shared office IP. */
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
const BANNED: RateStatus = {
  blocked: true,
  banned: true,
  retryAfterSeconds: 0,
};

function prune(now: number) {
  if (now - lastPrunedAt < PRUNE_EVERY_MS) return;
  lastPrunedAt = now;
  for (const [key, b] of buckets) {
    if (now - b.seen > IDLE_TTL_MS && b.blockedUntil <= now && !b.banned) {
      buckets.delete(key);
    }
  }
}

/** Drops the least recently seen first, sparing live blocks while it can. */
function evictOldest(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  // By `seen`, not insert order, or a busy old key goes before an idle new one.
  const byAge = [...buckets.entries()].sort((a, b) => a[1].seen - b[1].seen);
  for (const [key, b] of byAge) {
    if (buckets.size <= MAX_BUCKETS) return;
    if (!b.banned && b.blockedUntil <= now) buckets.delete(key);
  }
  // Only live blocks left, so the oldest goes rather than let the Map grow.
  for (const [key] of byAge) {
    if (buckets.size <= MAX_BUCKETS) return;
    buckets.delete(key);
  }
}

function standing(b: Bucket | undefined, now: number): RateStatus {
  if (!b) return OK;
  if (b.banned) return BANNED;
  if (b.blockedUntil > now) {
    return {
      blocked: true,
      banned: false,
      retryAfterSeconds: Math.ceil((b.blockedUntil - now) / 1000),
    };
  }
  return OK;
}

function peek(key: string): RateStatus {
  return standing(buckets.get(key), Date.now());
}

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
  buckets.set(key, b);

  // Already serving a lockout - report remaining time without escalating.
  const current = standing(b, now);
  if (current.blocked) return current;

  b.fails += 1;
  if (b.fails >= policy.maxAttempts) {
    b.lockouts += 1;
    b.fails = 0; // reset the window; the lockout is the penalty now

    if (policy.maxLockouts !== null && b.lockouts > policy.maxLockouts) {
      b.banned = true;
      b.blockedUntil = Number.MAX_SAFE_INTEGER;
      return BANNED;
    }

    const seconds = policy.blockBaseSeconds * b.lockouts;
    b.blockedUntil = now + seconds * 1000;
    return { blocked: true, banned: false, retryAfterSeconds: seconds };
  }

  return OK;
}

function strongest(a: RateStatus, b: RateStatus): RateStatus {
  if (a.banned) return a;
  if (b.banned) return b;
  if (!a.blocked && !b.blocked) return OK;
  return a.retryAfterSeconds >= b.retryAfterSeconds ? a : b;
}

// Namespaced, so an account can never collide with an IP of the same string.
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

export function checkLoginBlocked(ip: string, loginId: string): RateStatus {
  return strongest(peek(ipKey(ip)), peek(acctKey(loginId)));
}

export function registerLoginFailure(ip: string, loginId: string): RateStatus {
  // No short-circuit: each bucket's counter must advance on every attempt.
  const ipStatus = hit(ipKey(ip), ipPolicy());
  const acctStatus = hit(acctKey(loginId), accountPolicy());
  return strongest(ipStatus, acctStatus);
}

export function registerLoginSuccess(ip: string, loginId: string): void {
  buckets.delete(ipKey(ip));
  buckets.delete(acctKey(loginId));
}

export function checkBookingBlocked(ip: string): RateStatus {
  return peek(bookingKey(ip));
}

export function registerBooking(ip: string): RateStatus {
  return hit(bookingKey(ip), bookingPolicy());
}

// Set by a Cloudflare Transform Rule; absent on anything reaching Fly directly.
const PROOF_HEADER = "x-origin-proof";

// A shape guard, not a validator: it stops a junk header becoming a long key.
const IP_RE = /^[0-9a-f:.]{3,45}$/i;

function asIp(value: string | null | undefined): string {
  const ip = value?.trim() ?? "";
  return IP_RE.test(ip) ? ip : "";
}

/** Best-effort client IP; always a string, so unknowns share one bucket. */
export function clientKey(headers: Headers): string {
  // fly-client-ip is the real TCP peer, the one value a caller cannot choose.
  const peer = asIp(headers.get("fly-client-ip"));
  const secret = optionalEnv("TRUSTED_PROXY_SECRET");
  // No proof means no Cloudflare, so its address headers are its own invention.
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
