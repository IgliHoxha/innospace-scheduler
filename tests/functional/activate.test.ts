import { beforeEach, describe, expect, it } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { CORRECT } from "../helpers/fixtures";
import { SESSION_COOKIE, createInviteToken } from "@/lib/auth";

type Route = typeof import("@/app/api/activate/route");
type Db = typeof import("@/lib/db");
let route: Route;
let db: Db;

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/activate/route");
});

async function invited(email = "x@example.com") {
  const u = await db.inviteUser(email);
  return { u, token: createInviteToken(u.id) };
}

const post = (body: unknown) =>
  route.POST(makeRequest("/api/activate", { method: "POST", body }));
const get = (query: string) => route.GET(makeRequest(`/api/activate?${query}`));

describe("POST /api/activate", () => {
  it("400 for an invalid token", async () => {
    expect(
      (await post({ token: "garbage", name: "Ada", password: CORRECT })).status,
    ).toBe(400);
  });

  it("400 on a malformed JSON body (parse falls back to empty)", async () => {
    const res = await route.POST(
      makeRequest("/api/activate", { method: "POST", rawBody: "{ not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when the name is blank", async () => {
    const { token } = await invited();
    expect((await post({ token, name: "  ", password: CORRECT })).status).toBe(
      400,
    );
  });

  it("400 for a too-long name", async () => {
    const { token } = await invited();
    expect(
      (await post({ token, name: "x".repeat(81), password: CORRECT })).status,
    ).toBe(400);
  });

  it("400 for a too-short password", async () => {
    const { token } = await invited();
    expect((await post({ token, name: "Ada", password: "abc" })).status).toBe(
      400,
    );
  });

  it("200 completes the invite, signs in, and sets the session cookie", async () => {
    const { token } = await invited();
    const res = await post({
      token,
      name: "Ada Lovelace",
      password: CORRECT,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: "user" });
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
  });

  it("409 when the invite has already been used", async () => {
    const { token } = await invited();
    await post({ token, name: "Ada", password: CORRECT });
    expect((await post({ token, name: "Ada", password: CORRECT })).status).toBe(
      409,
    );
  });
});

describe("GET /api/activate (validate + prefill)", () => {
  it("400 for an invalid token", async () => {
    expect((await get("token=garbage")).status).toBe(400);
  });

  it("404 when the invited user is gone", async () => {
    const { u, token } = await invited();
    await db.deleteUser(u.id);
    expect((await get(`token=${token}`)).status).toBe(404);
  });

  it("200 returns the email for a valid pending invite", async () => {
    const { token } = await invited("prefill@example.com");
    const res = await get(`token=${token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      email: "prefill@example.com",
    });
  });

  it("409 once the account is already set up", async () => {
    const { u, token } = await invited();
    await db.activateUser(u.id, "Ada", CORRECT);
    expect((await get(`token=${token}`)).status).toBe(409);
  });
});
