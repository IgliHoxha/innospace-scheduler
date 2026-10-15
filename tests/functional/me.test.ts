import { beforeEach, describe, expect, it } from "vitest";
import { adminToken, makeRequest, memberToken, resetApp } from "../helpers/app";

type Route = typeof import("@/app/api/me/route");
let route: Route;

beforeEach(async () => {
  resetApp();
  route = await import("@/app/api/me/route");
});

const ask = (token?: string) => route.GET(makeRequest("/api/me", { token }));

// The booking page is cached at the edge for everyone, so this is the one place a session shows.
describe("GET /api/me", () => {
  it("names a member signed in with Google", async () => {
    const res = await ask(memberToken("Ada Lovelace", "ada@example.com"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      member: { name: "Ada Lovelace", email: "ada@example.com" },
    });
  });

  it("answers null for a guest", async () => {
    expect(await (await ask()).json()).toEqual({ ok: true, member: null });
  });

  it("answers null for the admin, who is no booker", async () => {
    expect(await (await ask(adminToken())).json()).toEqual({
      ok: true,
      member: null,
    });
  });

  it("answers null for a forged or expired cookie", async () => {
    expect(await (await ask("not.a.token")).json()).toEqual({
      ok: true,
      member: null,
    });
  });

  it("never lets a cache keep the answer", async () => {
    const res = await ask(memberToken());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
