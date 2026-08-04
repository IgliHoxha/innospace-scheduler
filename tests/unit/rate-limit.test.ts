import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The limiter keeps a module-level Map, so re-import per test; fake timers drive expiry.
type RateLimit = typeof import("@/lib/rate-limit");
let rl: RateLimit;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  rl = await import("@/lib/rate-limit");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const IP = "1.2.3.4";

/** Fail `n` times for (ip, login), returning the last status. */
function failN(ip: string, login: string, n: number) {
  let s = rl.checkLoginBlocked(ip, login);
  for (let i = 0; i < n; i++) s = rl.registerLoginFailure(ip, login);
  return s;
}

describe("checkLoginBlocked", () => {
  it("reports a fresh client as unblocked", () => {
    expect(rl.checkLoginBlocked(IP, "a@x.com")).toEqual({
      blocked: false,
      banned: false,
      retryAfterSeconds: 0,
    });
  });
});

describe("per-account bucket", () => {
  it("locks the account after LOGIN_MAX_ATTEMPTS failures", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "3");
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "60");
    const s = failN(IP, "member@x.com", 3);
    expect(s.blocked).toBe(true);
    expect(s.banned).toBe(false);
    expect(s.retryAfterSeconds).toBe(60);
  });

  it("escalates the account lockout linearly per lockout", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "2");
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "60");
    // Keep the IP threshold high so it never interferes.
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "1000");
    expect(failN(IP, "m@x.com", 2).retryAfterSeconds).toBe(60);
    vi.advanceTimersByTime(61_000);
    expect(failN(IP, "m@x.com", 2).retryAfterSeconds).toBe(120);
  });

  it("NEVER bans an account, no matter how many lockouts (anti-DoS)", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "1");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "100000");
    for (let i = 0; i < 50; i++) {
      const s = failN(IP, "victim@x.com", 1);
      expect(s.banned).toBe(false);
      vi.advanceTimersByTime((i + 2) * 1000);
    }
  });

  it("isolates one account from another on the same IP", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "3");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "1000");
    failN(IP, "attacked@x.com", 3); // this account is locked
    // A different member on the same IP is unaffected.
    expect(rl.checkLoginBlocked(IP, "other@x.com").blocked).toBe(false);
  });
});

describe("per-IP bucket", () => {
  it("locks the IP at its own (higher) threshold across many accounts", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "1000"); // accounts won't lock
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "5");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "60");
    // 5 failures spread across distinct accounts still trip the IP bucket.
    let s = rl.checkLoginBlocked(IP, "seed@x.com");
    for (let i = 0; i < 5; i++) s = rl.registerLoginFailure(IP, `u${i}@x.com`);
    expect(s.blocked).toBe(true);
    expect(s.retryAfterSeconds).toBe(60);
  });

  it("bans the IP once its lockouts exceed LOGIN_MAX_LOCKOUTS", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "100000");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "2");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "1");
    vi.stubEnv("LOGIN_MAX_LOCKOUTS", "2");
    expect(failN(IP, "a@x.com", 2).banned).toBe(false); // lockout 1
    vi.advanceTimersByTime(2_000);
    expect(failN(IP, "a@x.com", 2).banned).toBe(false); // lockout 2
    vi.advanceTimersByTime(3_000);
    expect(failN(IP, "a@x.com", 2).banned).toBe(true); // lockout 3 -> ban
    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
    expect(rl.checkLoginBlocked(IP, "a@x.com").banned).toBe(true);
  });

  it("isolates one IP from another", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "100000");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "3");
    failN("9.9.9.9", "a@x.com", 3); // 9.9.9.9 is locked
    expect(rl.checkLoginBlocked("8.8.8.8", "a@x.com").blocked).toBe(false);
  });
});

describe("registerLoginSuccess", () => {
  it("clears both the account and the IP buckets", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "3");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "3");
    rl.registerLoginFailure(IP, "m@x.com");
    rl.registerLoginFailure(IP, "m@x.com");
    rl.registerLoginSuccess(IP, "m@x.com");
    // Budget restored on both buckets: two more failures still don't lock.
    expect(rl.registerLoginFailure(IP, "m@x.com").blocked).toBe(false);
    expect(rl.registerLoginFailure(IP, "m@x.com").blocked).toBe(false);
  });
});

describe("account key normalisation", () => {
  it("treats the login case-insensitively and trims whitespace", () => {
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "2");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "1000");
    rl.registerLoginFailure(IP, "Member@X.com");
    const s = rl.registerLoginFailure(IP, "  member@x.com  ");
    expect(s.blocked).toBe(true); // same account -> 2 fails -> locked
  });
});

describe("clientKey", () => {
  it("prefers cf-connecting-ip, then fly-client-ip, then x-forwarded-for", () => {
    expect(
      rl.clientKey(
        new Headers({
          "cf-connecting-ip": "1.1.1.1",
          "fly-client-ip": "2.2.2.2",
          "x-forwarded-for": "3.3.3.3",
        }),
      ),
    ).toBe("1.1.1.1");
    expect(rl.clientKey(new Headers({ "fly-client-ip": "2.2.2.2" }))).toBe(
      "2.2.2.2",
    );
  });

  it("takes the first hop of a multi-value x-forwarded-for", () => {
    expect(
      rl.clientKey(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })),
    ).toBe("9.9.9.9");
  });

  it("falls back to 'unknown' when no IP header is present", () => {
    expect(rl.clientKey(new Headers())).toBe("unknown");
  });

  it("ignores a value that is not shaped like an address, so junk can't become a key", () => {
    const junk = new Headers({
      "cf-connecting-ip": "x".repeat(5000),
      "fly-client-ip": "2.2.2.2",
    });
    expect(rl.clientKey(junk)).toBe("2.2.2.2");
    expect(rl.clientKey(new Headers({ "cf-connecting-ip": "not an ip" }))).toBe(
      "unknown",
    );
  });

  it("accepts IPv6 and the IPv4-mapped form", () => {
    expect(rl.clientKey(new Headers({ "fly-client-ip": "2001:db8::1" }))).toBe(
      "2001:db8::1",
    );
    expect(
      rl.clientKey(new Headers({ "fly-client-ip": "::ffff:1.2.3.4" })),
    ).toBe("::ffff:1.2.3.4");
  });
});

// Without the proof, cf-connecting-ip is just something the caller typed, so the throttle must not key on it.
describe("clientKey with TRUSTED_PROXY_SECRET set", () => {
  const SECRET = "s3cr3t-proof";
  beforeEach(() => vi.stubEnv("TRUSTED_PROXY_SECRET", SECRET));

  const headers = (proof: string | null, cf = "1.1.1.1", peer = "2.2.2.2") => {
    const h = new Headers({ "cf-connecting-ip": cf, "fly-client-ip": peer });
    if (proof !== null) h.set("x-origin-proof", proof);
    return h;
  };

  it("trusts cf-connecting-ip when the proof matches", () => {
    expect(rl.clientKey(headers(SECRET))).toBe("1.1.1.1");
  });

  it("falls back to the real peer when the proof is missing, wrong, or empty", () => {
    for (const proof of [null, "wrong", "", `${SECRET}x`]) {
      expect(rl.clientKey(headers(proof))).toBe("2.2.2.2");
    }
  });

  it("ignores x-forwarded-for and x-real-ip on an unproven request too", () => {
    const h = new Headers({
      "x-forwarded-for": "9.9.9.9",
      "x-real-ip": "8.8.8.8",
      "fly-client-ip": "2.2.2.2",
    });
    expect(rl.clientKey(h)).toBe("2.2.2.2");
  });

  it("collapses an unproven request with no peer onto one shared bucket", () => {
    expect(rl.clientKey(new Headers({ "cf-connecting-ip": "1.1.1.1" }))).toBe(
      "unknown",
    );
  });

  it("so rotating a forged header cannot escape the throttle", () => {
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "3");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "60");
    // A different forged cf-connecting-ip each time, all from the one real peer.
    let last = rl.checkBookingBlocked("x");
    for (let i = 0; i < 3; i++) {
      last = rl.registerBooking(rl.clientKey(headers(null, `5.5.5.${i}`)));
    }
    expect(last.blocked).toBe(true);
  });
});

describe("booking throttle (public form)", () => {
  const bookN = (ip: string, n: number) => {
    let s = rl.checkBookingBlocked(ip);
    for (let i = 0; i < n; i++) s = rl.registerBooking(ip);
    return s;
  };

  it("reports a fresh client as unblocked", () => {
    expect(rl.checkBookingBlocked(IP)).toEqual({
      blocked: false,
      banned: false,
      retryAfterSeconds: 0,
    });
  });

  it("blocks once the per-IP attempt limit is reached", () => {
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "3");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "60");
    expect(bookN(IP, 2).blocked).toBe(false);
    const s = bookN(IP, 1);
    expect(s.blocked).toBe(true);
    expect(s.retryAfterSeconds).toBe(60);
    expect(rl.checkBookingBlocked(IP).blocked).toBe(true);
  });

  it("frees the client again once the lockout expires", () => {
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "2");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "60");
    bookN(IP, 2);
    vi.advanceTimersByTime(60_001);
    expect(rl.checkBookingBlocked(IP).blocked).toBe(false);
  });

  it("never bans: a shared office IP must not lose booking for good", () => {
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "1");
    vi.stubEnv("LOGIN_MAX_LOCKOUTS", "1");
    for (let i = 0; i < 10; i++) {
      rl.registerBooking(IP);
      vi.advanceTimersByTime(10_000);
    }
    expect(rl.checkBookingBlocked(IP).banned).toBe(false);
  });

  it("keys per IP, and never touches that IP's login bucket", () => {
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "2");
    bookN(IP, 2);
    expect(rl.checkBookingBlocked("9.9.9.9").blocked).toBe(false);
    expect(rl.checkLoginBlocked(IP, "admin").blocked).toBe(false);
  });
});

describe("env guards", () => {
  it("refuses a non-positive threshold rather than blocking everyone forever", async () => {
    for (const bad of ["0", "-1"]) {
      vi.stubEnv("LOGIN_MAX_ATTEMPTS", bad);
      const { registerLoginFailure } = await import("@/lib/rate-limit");
      expect(() => registerLoginFailure("1.1.1.1", "admin")).toThrow(
        /positive integer/i,
      );
    }
  });
});

describe("bucket housekeeping and repeat hits", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "60");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "60");
    vi.stubEnv("LOGIN_MAX_LOCKOUTS", "1");
  });
  afterEach(() => vi.useRealTimers());

  it("reports the remaining wait without escalating it further", async () => {
    const rl = await import("@/lib/rate-limit");
    expect(rl.registerLoginFailure("2.2.2.2", "a").retryAfterSeconds).toBe(60);
    vi.advanceTimersByTime(20_000);
    // 40s left, and the lockout has not been extended by the extra attempt.
    expect(rl.registerLoginFailure("2.2.2.2", "a").retryAfterSeconds).toBe(40);
  });

  it("keeps reporting a ban on every later attempt", async () => {
    const rl = await import("@/lib/rate-limit");
    rl.registerLoginFailure("3.3.3.3", "a");
    vi.advanceTimersByTime(61_000);
    expect(rl.registerLoginFailure("3.3.3.3", "a").banned).toBe(true);
    // Already banned: the next hit returns from the ban check, not the counter.
    expect(rl.registerLoginFailure("3.3.3.3", "a")).toEqual({
      blocked: true,
      banned: true,
      retryAfterSeconds: 0,
    });
  });

  it("forgets an idle, unblocked bucket after an hour", async () => {
    const rl = await import("@/lib/rate-limit");
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "5"); // stay under the account lockout
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "100"); // and well under the IP one
    rl.registerLoginFailure("4.4.4.4", "idle-user");
    vi.advanceTimersByTime(61 * 60 * 1000);
    // Pruned, so the budget starts over rather than carrying an hour-old failure.
    rl.registerLoginFailure("5.5.5.5", "someone-else");
    expect(rl.checkLoginBlocked("4.4.4.4", "idle-user").blocked).toBe(false);
    for (let i = 0; i < 4; i++) rl.registerLoginFailure("4.4.4.4", "idle-user");
    expect(rl.checkLoginBlocked("4.4.4.4", "idle-user").blocked).toBe(false);
  });
});

// A forged address header mints a bucket, so the Map is capped rather than left to eat the machine.
describe("the bucket cap", () => {
  // Above MAX_BUCKETS (10k), so eviction runs; the clock is frozen so pruning can't do the work instead.
  const FLOOD = 10_010;
  const flood = () => {
    for (let i = 0; i < FLOOD; i++) rl.registerBooking(`flood-${i}`);
  };

  beforeEach(() => {
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "2");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "60");
  });

  it("forgets the least recently seen bucket rather than growing without bound", () => {
    rl.registerBooking("early"); // one failure short of blocking
    flood();
    // Evicted as the oldest, so its budget starts over: memory wins over a half-used counter.
    expect(rl.registerBooking("early").blocked).toBe(false);
  });

  it("spares a bucket that is actively blocked, so a flood can't wash out a lockout", () => {
    rl.registerBooking("abuser");
    expect(rl.registerBooking("abuser").blocked).toBe(true);
    flood();
    expect(rl.checkBookingBlocked("abuser").blocked).toBe(true);
  });

  it("spares a banned bucket through the same flood", () => {
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "1");
    vi.stubEnv("LOGIN_MAX_LOCKOUTS", "1");
    rl.registerLoginFailure("6.6.6.6", "a");
    vi.advanceTimersByTime(2_000);
    expect(rl.registerLoginFailure("6.6.6.6", "a").banned).toBe(true);
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "2");
    flood();
    expect(rl.checkLoginBlocked("6.6.6.6", "a").banned).toBe(true);
  });
});

describe("two buckets blocking at once", () => {
  it("reports the longer of the two waits", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "30"); // account: shorter
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "600"); // IP: longer
    vi.stubEnv("LOGIN_MAX_LOCKOUTS", "10");
    const rl = await import("@/lib/rate-limit");
    // Both trip on this one failure, so the strongest must win.
    expect(rl.registerLoginFailure("7.7.7.7", "a").retryAfterSeconds).toBe(600);
    vi.useRealTimers();
  });
});
