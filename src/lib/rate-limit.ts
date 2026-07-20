// In-memory brute-force guard for the login route. The app runs as a single
// long-lived Node process (one Fly machine), so a module-level Map is sufficient
// - no external store needed. State resets on redeploy/restart, which is fine for
// login throttling.
//
// The scheduler is members-only and the whole coworking space shares one public
// IP, so a single IP bucket would let one attacker (or one confused member) lock
// everyone out. We therefore track TWO independent buckets:
//   • per-account - low threshold, escalating lockout, NEVER a permanent ban
//     (an attacker must not be able to lock a member out forever).
//   • per-IP      - high threshold (tolerates the shared office IP), escalating
//     lockout, and a ban only after sustained abuse.

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

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Per-account: strict, but never a permanent ban (avoids member lockout DoS). */
function accountPolicy(): Policy {
  return {
    maxAttempts: envInt("LOGIN_MAX_ATTEMPTS", 5),
    blockBaseSeconds: envInt("LOGIN_BLOCK_SECONDS", 60),
    maxLockouts: null,
  };
}

/** Per-IP: lenient threshold (shared office IP), bans only under sustained abuse. */
function ipPolicy(): Policy {
  return {
    maxAttempts: envInt("LOGIN_IP_MAX_ATTEMPTS", 20),
    blockBaseSeconds: envInt("LOGIN_IP_BLOCK_SECONDS", 60),
    maxLockouts: envInt("LOGIN_MAX_LOCKOUTS", 10),
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
