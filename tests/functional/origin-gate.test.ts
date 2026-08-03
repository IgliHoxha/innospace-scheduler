// One pass over every state-changing handler: a disallowed Origin must be refused before any work.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminToken, makeRequest, params, resetApp } from "../helpers/app";

const BAD_ORIGIN = { origin: "https://evil.test" };

function req(method: string, token?: string) {
  return makeRequest("/api/x", {
    method,
    headers: BAD_ORIGIN,
    token,
    body: {},
  });
}

async function expectForbidden(res: Response) {
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ ok: false, error: "Forbidden" });
}

beforeEach(() => {
  resetApp();
  vi.stubEnv("ALLOWED_ORIGINS", "https://app.test");
});
afterEach(() => vi.unstubAllEnvs());

describe("origin gate on mutating handlers", () => {
  it("login POST is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/login/route");
    await expectForbidden(await route.POST(req("POST")));
  });

  it("login DELETE (logout) is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/login/route");
    await expectForbidden(await route.DELETE(req("DELETE", adminToken())));
  });

  it("cancel POST is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/cancel/route");
    await expectForbidden(await route.POST(req("POST")));
  });

  it("reservations POST is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/reservations/route");
    await expectForbidden(await route.POST(req("POST")));
  });

  it("reservations DELETE is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/reservations/route");
    await expectForbidden(await route.DELETE(req("DELETE", adminToken())));
  });

  it("reservation PATCH is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/reservations/[id]/route");
    const res = await route.PATCH(
      req("PATCH", adminToken()),
      params({ id: "res-1" }),
    );
    await expectForbidden(res);
  });

  // Regression: a page posting to its own API is same-origin, never CSRF, so it must pass unlisted.
  it("allows the app calling its own API (same-origin, not on the list)", async () => {
    const route = await import("@/app/api/login/route");
    const res = await route.DELETE(
      makeRequest("http://sched.test/api/login", {
        method: "DELETE",
        headers: { origin: "https://sched.test", host: "sched.test" },
        token: adminToken(),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("still allows a request from the configured origin", async () => {
    const route = await import("@/app/api/login/route");
    const res = await route.POST(
      makeRequest("/api/login", {
        method: "POST",
        headers: { origin: "https://app.test" },
        body: {},
      }),
    );
    // Passes the origin gate (400 for the empty body), i.e. not a 403.
    expect(res.status).not.toBe(403);
  });
});
