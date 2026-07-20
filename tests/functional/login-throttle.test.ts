import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { DEFAULT_ADMIN_PASS, DEFAULT_ADMIN_USER } from "../helpers/fixtures";

// resetApp() re-imports the route (and with it a fresh in-memory limiter Map),
// so every test starts clean.
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
