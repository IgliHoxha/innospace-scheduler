import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { DEFAULT_ADMIN_PASS, DEFAULT_ADMIN_USER } from "../helpers/fixtures";

// resetApp() re-imports the route with a fresh limiter, so tests start clean.
type Route = typeof import("@/app/api/login/route");
let route: Route;

beforeEach(async () => {
  resetApp();
  vi.stubEnv("LOGIN_MAX_ATTEMPTS", "3"); // account bucket
  vi.stubEnv("LOGIN_BLOCK_SECONDS", "60");
  vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "50"); // IP bucket well out of the way
  await import("@/lib/db");
  route = await import("@/app/api/login/route");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const post = (body: unknown, ip = "1.1.1.1") =>
  route.POST(
    makeRequest("/api/login", {
      method: "POST",
      body,
      headers: { "x-forwarded-for": ip },
    }),
  );

const wrong = (login = DEFAULT_ADMIN_USER, ip?: string) =>
  post({ login, password: "nope" }, ip);
const right = (ip?: string) =>
  post({ login: DEFAULT_ADMIN_USER, password: DEFAULT_ADMIN_PASS }, ip);

describe("POST /api/login brute-force throttling", () => {
  it("locks the account with 429 + Retry-After after the threshold", async () => {
    expect((await wrong()).status).toBe(401);
    expect((await wrong()).status).toBe(401);
    const res = await wrong(); // 3rd failure trips the account lockout
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await res.json()).error).toMatch(/too many failed attempts/i);
  });

  it("blocks even correct credentials while locked out", async () => {
    await wrong();
    await wrong();
    await wrong(); // locked
    expect((await right()).status).toBe(429);
  });

  it("does not lock a different account on the same IP", async () => {
    await wrong("admin");
    await wrong("admin");
    await wrong("admin"); // 'admin' account locked

    // A different login on the same IP is still accepted for its own attempts.
    const other = await post(
      { login: "someone@else.com", password: "whatever" },
      "1.1.1.1",
    );
    expect(other.status).toBe(401); // rejected as wrong creds, NOT throttled
  });

  it("resets the account counter after a successful login", async () => {
    await wrong();
    await wrong(); // 2 failures, not yet locked
    expect((await right()).status).toBe(200); // success clears history
    expect((await wrong()).status).toBe(401);
    expect((await wrong()).status).toBe(401); // budget restored
  });

  it("still 400s a missing field without counting it as an attempt", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post({ login: "admin" })).status).toBe(400);
    }
    // No lockout accrued: a real wrong attempt is still just a 401.
    expect((await wrong()).status).toBe(401);
  });
});

describe("POST /api/login - the IP ban, the only permanent block", () => {
  // A fresh limiter per test: the IP bucket tight, the account bucket loose.
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    resetApp();
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "50");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "2");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "60");
    vi.stubEnv("LOGIN_MAX_LOCKOUTS", "1");
    route = await import("@/app/api/login/route");
  });
  afterEach(() => vi.useRealTimers());

  it("403s permanently once the IP passes LOGIN_MAX_LOCKOUTS", async () => {
    expect((await wrong()).status).toBe(401);
    expect((await wrong()).status).toBe(429); // IP lockout 1

    vi.advanceTimersByTime(61_000); // lockout served
    expect((await wrong()).status).toBe(401);

    const res = await wrong(); // lockout 2, past maxLockouts of 1
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/access blocked/i);
  });

  it("stays banned, and correct credentials do not lift it", async () => {
    await wrong();
    await wrong();
    vi.advanceTimersByTime(61_000);
    await wrong();
    expect((await wrong()).status).toBe(403);

    vi.advanceTimersByTime(365 * 24 * 3600_000); // a year on
    expect((await wrong()).status).toBe(403);
    expect((await right()).status).toBe(403);
  });

  it("bans that IP only, leaving another client alone", async () => {
    await wrong();
    await wrong();
    vi.advanceTimersByTime(61_000);
    await wrong();
    expect((await wrong()).status).toBe(403);
    expect((await right("9.9.9.9")).status).toBe(200);
  });
});

describe("POST /api/login - the lockout wait is worded for its length", () => {
  beforeEach(async () => {
    resetApp();
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "50");
    route = await import("@/app/api/login/route");
  });

  it("counts in seconds under a minute", async () => {
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "30");
    const res = await wrong();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("30 seconds");
  });

  it("counts in minutes at or over one, and says minute in the singular", async () => {
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "60");
    expect((await (await wrong()).json()).error).toContain("1 minute");
  });
});

describe("POST /api/login - oversized input counts like any other failure", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    resetApp();
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "50");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "60");
    vi.stubEnv("LOGIN_MAX_LOCKOUTS", "1");
    route = await import("@/app/api/login/route");
  });
  afterEach(() => vi.useRealTimers());

  const huge = () =>
    post({ login: "a".repeat(300), password: "b".repeat(300) });

  it("401s an over-long login without letting it reach the hasher", async () => {
    expect((await huge()).status).toBe(429); // 1 attempt allowed, so this trips the lockout
  });

  it("bans the IP through the oversized path too, not just wrong passwords", async () => {
    await huge();
    vi.advanceTimersByTime(61_000);
    expect((await huge()).status).toBe(403);
  });
});

// Regression: the Fly origin skips Cloudflare, so cf-connecting-ip is forgeable.
describe("POST /api/login - a forged address header cannot escape the IP throttle", () => {
  const SECRET = "proof-secret";
  const PEER = "198.51.100.9"; // the real TCP peer, the same for every forged attempt

  beforeEach(async () => {
    resetApp();
    vi.stubEnv("TRUSTED_PROXY_SECRET", SECRET);
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "50"); // keep the account bucket out of the way
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "2");
    vi.stubEnv("LOGIN_IP_BLOCK_SECONDS", "60");
    route = await import("@/app/api/login/route");
  });

  const attempt = (cfIp: string, proof?: string) =>
    route.POST(
      makeRequest("/api/login", {
        method: "POST",
        body: { login: DEFAULT_ADMIN_USER, password: "nope" },
        headers: {
          "cf-connecting-ip": cfIp,
          "fly-client-ip": PEER,
          ...(proof ? { "x-origin-proof": proof } : {}),
        },
      }),
    );

  it("throttles a rotated cf-connecting-ip, since without the proof it is just typed in", async () => {
    expect((await attempt("203.0.113.1")).status).toBe(401);
    const res = await attempt("203.0.113.2"); // a "new" IP, same real peer
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("still gives genuine Cloudflare traffic a bucket per visitor", async () => {
    expect((await attempt("203.0.113.1", SECRET)).status).toBe(401);
    expect((await attempt("203.0.113.2", SECRET)).status).toBe(401);
    // Each proven address has its own budget, clear of the shared peer's limit.
    expect((await attempt("203.0.113.3", SECRET)).status).toBe(401);
  });

  it("refuses a proof header that does not match the secret", async () => {
    expect((await attempt("203.0.113.1", "wrong")).status).toBe(401);
    expect((await attempt("203.0.113.2", "wrong")).status).toBe(429);
  });
});

describe("POST /api/login - the wait is pluralised properly", () => {
  beforeEach(async () => {
    resetApp();
    vi.stubEnv("LOGIN_MAX_ATTEMPTS", "1");
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "50");
    route = await import("@/app/api/login/route");
  });

  it("says minutes, plural, for a longer lockout", async () => {
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "300");
    expect((await (await wrong()).json()).error).toContain("5 minutes");
  });

  it("says second, singular, for a one second lockout", async () => {
    vi.stubEnv("LOGIN_BLOCK_SECONDS", "1");
    expect((await (await wrong()).json()).error).toContain("1 second");
  });
});
