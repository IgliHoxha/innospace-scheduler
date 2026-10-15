import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  googleAuthorizeUrl,
  googleProfileForCode,
  googleRedirectUri,
  googleSignInEnabled,
  newOAuthState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  profileFromIdToken,
} from "@/lib/google-auth";

const CLIENT_ID = "fixture-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "fixture-client-secret";

const b64 = (o: object) =>
  Buffer.from(JSON.stringify(o), "utf8").toString("base64url");

/** An id token as Google's token endpoint hands one back; the signature is never checked. */
function idToken(claims: Record<string, unknown>): string {
  return `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
}

const ada = {
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  sub: "google-sub-1",
  exp: Math.floor(Date.now() / 1000) + 3600,
  email: "Ada@Example.com",
  email_verified: true,
  name: "Ada Lovelace",
};

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", CLIENT_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("googleSignInEnabled", () => {
  it("needs both the id and the secret", () => {
    expect(googleSignInEnabled()).toBe(true);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(googleSignInEnabled()).toBe(false);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", CLIENT_SECRET);
    vi.stubEnv("GOOGLE_CLIENT_ID", "   ");
    expect(googleSignInEnabled()).toBe(false);
  });
});

describe("the authorize redirect", () => {
  it("builds the callback from APP_BASE_URL without doubling a slash", () => {
    expect(googleRedirectUri()).toBe(
      "https://scheduler.example.test/api/auth/google/callback",
    );
    vi.stubEnv("APP_BASE_URL", "https://staging.example.com/");
    expect(googleRedirectUri()).toBe(
      "https://staging.example.com/api/auth/google/callback",
    );
  });

  it("sends the person to Google with the code flow, the scopes and the state", () => {
    const url = new URL(googleAuthorizeUrl("state-123"));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(googleRedirectUri());
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    // The secret belongs to the token exchange, never to a browser redirect.
    expect(url.href).not.toContain(CLIENT_SECRET);
  });

  it("mints a fresh unguessable state each time", () => {
    const a = newOAuthState();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newOAuthState()).not.toBe(a);
  });

  it("keeps the state in a short-lived cookie of its own", () => {
    expect(OAUTH_STATE_COOKIE).toBe("innospace_oauth_state");
    expect(OAUTH_STATE_TTL_SECONDS).toBe(600);
  });
});

describe("profileFromIdToken", () => {
  it("reads the account id, name and lower-cased email", () => {
    expect(profileFromIdToken(idToken(ada), CLIENT_ID)).toEqual({
      sub: "google-sub-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("accepts the bare issuer Google also uses", () => {
    expect(
      profileFromIdToken(
        idToken({ ...ada, iss: "accounts.google.com" }),
        CLIENT_ID,
      ),
    ).not.toBeNull();
  });

  it("falls back to the given and family names, then the mailbox", () => {
    expect(
      profileFromIdToken(
        idToken({ ...ada, name: "", given_name: "Ada", family_name: "L" }),
        CLIENT_ID,
      )?.name,
    ).toBe("Ada L");
    expect(
      profileFromIdToken(idToken({ ...ada, name: undefined }), CLIENT_ID)?.name,
    ).toBe("ada");
  });

  it("refuses a token minted for another app", () => {
    expect(
      profileFromIdToken(idToken({ ...ada, aud: "other-app" }), CLIENT_ID),
    ).toBeNull();
  });

  it("refuses another issuer", () => {
    expect(
      profileFromIdToken(
        idToken({ ...ada, iss: "https://evil.example" }),
        CLIENT_ID,
      ),
    ).toBeNull();
  });

  it("refuses an expired token", () => {
    expect(
      profileFromIdToken(idToken({ ...ada, exp: ada.exp - 7200 }), CLIENT_ID),
    ).toBeNull();
  });

  // The booking email is the identity, so an unverified one proves nothing.
  it("refuses an unverified email, or none at all", () => {
    expect(
      profileFromIdToken(idToken({ ...ada, email_verified: false }), CLIENT_ID),
    ).toBeNull();
    expect(
      profileFromIdToken(idToken({ ...ada, email: undefined }), CLIENT_ID),
    ).toBeNull();
  });

  it("refuses a token with no account id, and anything that is not a token", () => {
    expect(
      profileFromIdToken(idToken({ ...ada, sub: undefined }), CLIENT_ID),
    ).toBeNull();
    expect(profileFromIdToken(undefined, CLIENT_ID)).toBeNull();
    expect(profileFromIdToken("two.parts", CLIENT_ID)).toBeNull();
    expect(profileFromIdToken("a.b.c", CLIENT_ID)).toBeNull();
  });
});

describe("googleProfileForCode", () => {
  // Typed like fetch, so the calls read back as a URL and its init.
  const exchange = (reply: () => Promise<unknown> | unknown) => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => reply());
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const okWith = (body: unknown) => ({ ok: true, json: async () => body });

  it("posts the code with the secret to Google's token endpoint and reads the id token", async () => {
    const fetchMock = exchange(() => okWith({ id_token: idToken(ada) }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(googleProfileForCode("code-1")).resolves.toEqual({
      sub: "google-sub-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    const [url, init] = fetchMock.mock.calls[0];
    if (!init) throw new Error("fetch was called without an init");
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    const sent = new URLSearchParams(String(init.body));
    expect(sent.get("code")).toBe("code-1");
    expect(sent.get("client_id")).toBe(CLIENT_ID);
    expect(sent.get("client_secret")).toBe(CLIENT_SECRET);
    expect(sent.get("redirect_uri")).toBe(googleRedirectUri());
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("gives up after ten seconds", async () => {
    const fetchMock = exchange(() => okWith({ id_token: idToken(ada) }));
    await googleProfileForCode("code-1");
    const init = fetchMock.mock.calls[0][1];
    if (!init) throw new Error("fetch was called without an init");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves null, never throws, when Google refuses the code", async () => {
    exchange(() => ({ ok: false, status: 400, json: async () => ({}) }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(googleProfileForCode("bad")).resolves.toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("resolves null when the exchange throws or times out", async () => {
    exchange(() => {
      throw new Error("ECONNRESET");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(googleProfileForCode("code-1")).resolves.toBeNull();
    err.mockRestore();
  });

  it("resolves null when the reply carries no usable id token", async () => {
    exchange(() => okWith({ access_token: "x" }));
    await expect(googleProfileForCode("code-1")).resolves.toBeNull();
    exchange(() =>
      okWith({ id_token: idToken({ ...ada, email_verified: false }) }),
    );
    await expect(googleProfileForCode("code-1")).resolves.toBeNull();
  });
});
