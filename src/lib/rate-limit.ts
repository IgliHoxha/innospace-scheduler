// In-memory login brute-force guard (module-level Map; single long-lived Fly
// machine, so state resets on restart). Two buckets so one attacker can't lock
// everyone out: per-account (escalating, never a permanent ban) + per-IP
// (lenient, tolerates the shared office IP).

import { requireIntEnv } from "./env-app";

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

/** Per-account: strict, but never a permanent ban (avoids member lockout DoS). */
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

/**
 * Per-IP throttle for password-reset requests, so the endpoint can't be used to
 * spam a member's inbox. Reuses the per-IP login thresholds but never bans (it
 * would be a self-inflicted DoS on the shared office IP for a public form).
 */
function resetPolicy(): Policy {
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
  for (const [key, b] of buckets) {
    if (now - b.seen > IDLE_TTL_MS && b.blockedUntil <= now && !b.banned) {
      buckets.delete(key);
    }
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
// Own namespace so reset throttling can never lock a member's real login bucket.
function resetKey(ip: string): string {
  return `reset:${ip}`;
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

/** Is this IP currently throttled for password-reset requests? Read-only. */
export function checkResetBlocked(ip: string): RateStatus {
  return peek(resetKey(ip));
}

/** Record a password-reset request against the per-IP reset throttle. */
export function registerResetRequest(ip: string): RateStatus {
  return hit(resetKey(ip), resetPolicy());
}

/**
 * Best-effort client IP. Behind Cloudflare → Fly, the real IP is in
 * `cf-connecting-ip` / `fly-client-ip`; fall back to the first `x-forwarded-for`
 * hop. Returns a stable string so unknown clients still share one bucket.
 */
export function clientKey(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("fly-client-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
