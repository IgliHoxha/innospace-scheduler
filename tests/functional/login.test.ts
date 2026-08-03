import { beforeEach, describe, expect, it } from "vitest";
import { adminToken, makeRequest, resetApp } from "../helpers/app";
import { DEFAULT_ADMIN_PASS, DEFAULT_ADMIN_USER } from "../helpers/fixtures";
import { SESSION_COOKIE } from "@/lib/auth";

type LoginRoute = typeof import("@/app/api/login/route");

let route: LoginRoute;

beforeEach(async () => {
  resetApp();
  route = await import("@/app/api/login/route");
});

async function post(body: unknown) {
  const res = await route.POST(
    makeRequest("/api/login", { method: "POST", body }),
  );
  return {
    res,
    json: (await res.json()) as { ok: boolean; role?: string; error?: string },
  };
}

describe("POST /api/login", () => {
  it("signs in the admin with the default env credentials and sets a session cookie", async () => {
    const { res, json } = await post({
      login: DEFAULT_ADMIN_USER,
      password: DEFAULT_ADMIN_PASS,
    });
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, role: "admin" });
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
  });

  it("400s when a field is missing", async () => {
    const { res, json } = await post({ login: "admin" });
    expect(res.status).toBe(400);
    expect(json.ok).toBe(false);
  });

  it("400s on a malformed JSON body (parse falls back to empty)", async () => {
    const res = await route.POST(
      makeRequest("/api/login", { method: "POST", rawBody: "{ not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("401s on a wrong password without leaking which field failed", async () => {
    const { res, json } = await post({ login: "admin", password: "wrong" });
    expect(res.status).toBe(401);
    expect(json.error).toBe("Incorrect login or password.");
  });

  it("401s on over-long input before doing any real work", async () => {
    const { res } = await post({ login: "a".repeat(300), password: "x" });
    expect(res.status).toBe(401);
  });

  it("401s any non-admin login: booking needs no account, so none exists", async () => {
    const { res } = await post({
      login: "member@example.com",
      password: "whatever",
    });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/login", () => {
  it("signs out by clearing the session cookie when authenticated", async () => {
    const res = await route.DELETE(
      makeRequest("/api/login", { method: "DELETE", token: adminToken() }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Deletion is surfaced as an expired/empty cookie.
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeFalsy();
  });

  it("rejects a logout with no session (forged cross-site DELETE)", async () => {
    const res = await route.DELETE(
      makeRequest("/api/login", { method: "DELETE" }),
    );
    expect(res.status).toBe(401);
    // No Set-Cookie: an unauthenticated request can't clear anyone's session.
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeFalsy();
  });
});
