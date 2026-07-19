import { beforeEach, describe, expect, it } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import {
  CORRECT,
  DEFAULT_ADMIN_PASS,
  DEFAULT_ADMIN_USER,
} from "../helpers/fixtures";
import { SESSION_COOKIE } from "@/lib/auth";

type LoginRoute = typeof import("@/app/api/login/route");
type Db = typeof import("@/lib/db");

let route: LoginRoute;
let db: Db;

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
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

  it("signs in an activated member by email + password", async () => {
    const u = await db.inviteUser("member@example.com");
    await db.activateUser(u.id, "Ada Lovelace", CORRECT);

    const { res, json } = await post({
      login: "member@example.com",
      password: CORRECT,
    });
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, role: "user" });
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

  it("rejects a member with the right email but wrong password", async () => {
    const u = await db.inviteUser("member@example.com");
    await db.activateUser(u.id, "Ada", CORRECT);
    const { res } = await post({
      login: "member@example.com",
      password: "nope",
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invited-but-not-activated member (empty password hash)", async () => {
    await db.inviteUser("pending@example.com");
    const { res } = await post({ login: "pending@example.com", password: "" });
    expect(res.status).toBe(400); // empty password fails the presence check first
  });
});

describe("DELETE /api/login", () => {
  it("signs out by clearing the session cookie", async () => {
    const res = await route.DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // Deletion is surfaced as an expired/empty cookie.
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeFalsy();
  });
});
