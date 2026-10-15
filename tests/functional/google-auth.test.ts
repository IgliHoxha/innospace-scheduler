import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { OAUTH_STATE_COOKIE } from "@/lib/google-auth";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const CLIENT_ID = "fixture-client-id.apps.googleusercontent.com";
const BASE = "https://scheduler.example.test";

type Start = typeof import("@/app/api/auth/google/route");
type Callback = typeof import("@/app/api/auth/google/callback/route");
let start: Start;
let callback: Callback;

const b64 = (o: object) =>
  Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
const idToken = (claims: Record<string, unknown>) =>
  `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
const ada = {
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  sub: "google-sub-1",
  exp: Math.floor(Date.now() / 1000) + 3600,
  email: "ada@example.com",
  email_verified: true,
  name: "Ada Lovelace",
};

/** Google's token endpoint, answering with whatever the test scripted. */
function stubGoogle(reply: () => unknown) {
  const fetchMock = vi.fn(async () => reply());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-client-secret");
  resetApp();
  start = await import("@/app/api/auth/google/route");
  callback = await import("@/app/api/auth/google/callback/route");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const answer = (query: string, state?: string) =>
  callback.GET(
    makeRequest(`/api/auth/google/callback?${query}`, {
      headers: state ? { cookie: `${OAUTH_STATE_COOKIE}=${state}` } : {},
    }),
  );

describe("GET /api/auth/google", () => {
  it("redirects to Google with a state it also sets as a cookie", async () => {
    const res = await start.GET();
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://accounts.google.com");
    expect(to.searchParams.get("redirect_uri")).toBe(
      `${BASE}/api/auth/google/callback`,
    );
    const cookie = res.cookies.get(OAUTH_STATE_COOKIE);
    expect(cookie?.value).toBe(to.searchParams.get("state"));
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(600);
  });

  it("is a 404 while Google sign-in is not configured", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const res = await start.GET();
    expect(res.status).toBe(404);
  });
});

describe("GET /api/auth/google/callback", () => {
  it("signs the person in as a member and sends them to the booking screen", async () => {
    const fetchMock = stubGoogle(() => ({
      ok: true,
      json: async () => ({ id_token: idToken(ada) }),
    }));
    const res = await answer("state=s1&code=code-1", "s1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE}/`);

    const session = verifySessionToken(res.cookies.get(SESSION_COOKIE)?.value);
    expect(session).toEqual({
      role: "member",
      sub: "google-sub-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    const cookie = res.cookies.get(SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);
    // The state is spent: the cookie goes with the redirect.
    expect(res.cookies.get(OAUTH_STATE_COOKIE)?.value).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refuses an answer whose state does not match this browser's", async () => {
    const fetchMock = stubGoogle(() => {
      throw new Error("must not be called");
    });
    for (const [query, cookie] of [
      ["state=other&code=code-1", "s1"],
      ["state=s1&code=code-1", undefined],
      ["code=code-1", "s1"],
      ["state=s1", "s1"],
    ] as const) {
      const res = await answer(query, cookie);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`${BASE}/?signin=failed`);
      expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the person back as a guest when Google refuses the code", async () => {
    stubGoogle(() => ({ ok: false, status: 400, json: async () => ({}) }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await answer("state=s1&code=bad", "s1");
    expect(res.headers.get("location")).toBe(`${BASE}/?signin=failed`);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(res.cookies.get(OAUTH_STATE_COOKIE)?.value).toBe("");
    err.mockRestore();
  });

  it("never signs in an unverified address", async () => {
    stubGoogle(() => ({
      ok: true,
      json: async () => ({
        id_token: idToken({ ...ada, email_verified: false }),
      }),
    }));
    const res = await answer("state=s1&code=code-1", "s1");
    expect(res.headers.get("location")).toBe(`${BASE}/?signin=failed`);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("is a 404 while Google sign-in is not configured", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect((await answer("state=s1&code=c", "s1")).status).toBe(404);
  });
});
