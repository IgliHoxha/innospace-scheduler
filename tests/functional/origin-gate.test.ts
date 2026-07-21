// One deliberate pass over every state-changing handler: with ALLOWED_ORIGINS
// set, a request whose Origin isn't allowed must be refused 403 before any work
// (CSRF defense in depth). A valid token on the authenticated routes proves the
// 403 comes from the origin gate running first, not from the auth guard.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminToken,
  makeRequest,
  params,
  resetApp,
  userToken,
} from "../helpers/app";

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

  it("activate POST is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/activate/route");
    await expectForbidden(await route.POST(req("POST")));
  });

  it("reservations POST is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/reservations/route");
    await expectForbidden(await route.POST(req("POST", userToken("u1"))));
  });

  it("reservations DELETE is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/reservations/route");
    await expectForbidden(await route.DELETE(req("DELETE", adminToken())));
  });

  it("reservation PATCH is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/reservations/[id]/route");
    const res = await route.PATCH(
      req("PATCH", userToken("u1")),
      params({ id: "res-1" }),
    );
    await expectForbidden(res);
  });

  it("users POST (invite) is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/users/route");
    await expectForbidden(await route.POST(req("POST", adminToken())));
  });

  it("user DELETE is refused from a disallowed origin", async () => {
    const route = await import("@/app/api/users/[id]/route");
    const res = await route.DELETE(
      req("DELETE", adminToken()),
      params({ id: "user-1" }),
    );
    await expectForbidden(res);
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
