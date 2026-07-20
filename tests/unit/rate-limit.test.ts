import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The limiter keeps a module-level Map, so re-import it fresh per test to reset
// state. Fake timers drive Date.now() for lockout-expiry / escalation logic.
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
});
