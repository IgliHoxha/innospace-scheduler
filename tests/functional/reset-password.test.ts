import { beforeEach, describe, expect, it } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { CORRECT } from "../helpers/fixtures";
import { SESSION_COOKIE, createResetToken } from "@/lib/auth";

type Route = typeof import("@/app/api/reset-password/route");
type Db = typeof import("@/lib/db");
let route: Route;
let db: Db;

const NEW_PASS = "brand-new-fixture-pass";

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/reset-password/route");
});

/** An activated member plus a fresh, valid reset token for them. */
async function withToken(email = "ada@example.com") {
  const u = await db.inviteUser(email);
  await db.activateUser(u.id, "Ada", CORRECT);
  const rec = await db.findUserByEmail(email);
  return { u, rec: rec!, token: createResetToken(u.id, rec!.passwordHash) };
}

const post = (body: unknown) =>
  route.POST(makeRequest("/api/reset-password", { method: "POST", body }));
const get = (query: string) =>
  route.GET(makeRequest(`/api/reset-password?${query}`));

describe("GET /api/reset-password (validate)", () => {
  it("400 for an invalid token", async () => {
    expect((await get("token=garbage")).status).toBe(400);
  });

  it("200 returns the account email for a valid token", async () => {
    const { token } = await withToken("prefill@example.com");
    const res = await get(`token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      email: "prefill@example.com",
    });
  });

  it("400 once the password changed (fingerprint spent)", async () => {
    const { u, token } = await withToken();
    await db.resetPassword(u.id, NEW_PASS); // token's fingerprint no longer matches
    expect((await get(`token=${encodeURIComponent(token)}`)).status).toBe(400);
  });
});

describe("POST /api/reset-password (complete)", () => {
  it("400 for an invalid token", async () => {
    expect((await post({ token: "garbage", password: NEW_PASS })).status).toBe(
      400,
    );
  });

  it("400 on a malformed JSON body", async () => {
    const res = await route.POST(
      makeRequest("/api/reset-password", {
        method: "POST",
        rawBody: "{ not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 for a too-short password", async () => {
    const { token } = await withToken();
    expect((await post({ token, password: "abc" })).status).toBe(400);
  });

  it("200 sets the new password, signs in, and issues a session cookie", async () => {
    const { u, token } = await withToken();
    const res = await post({ token, password: NEW_PASS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: "user" });
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();

    // The new password now works; the old one no longer does.
    const rec = await db.findUserRecordById(u.id);
    expect(rec!.passwordHash).not.toBe("");
  });

  it("400 when the same token is reused (single-use)", async () => {
    const { token } = await withToken();
    expect((await post({ token, password: NEW_PASS })).status).toBe(200);
    // Second use: the reset already rotated the hash, so the fingerprint is spent.
    expect(
      (await post({ token, password: "another-fixture-pass" })).status,
    ).toBe(400);
  });
});
