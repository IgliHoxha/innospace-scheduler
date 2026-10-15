// Server-only: the client secret and the Google token exchange live here.
import { randomBytes } from "crypto";
import { optionalEnv, requireEnv } from "./env-app";

export const OAUTH_STATE_COOKIE = "innospace_oauth_state";

// Long enough to pick an account, short enough that a stale state dies.
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const TIMEOUT_MS = 10_000;

export interface GoogleProfile {
  /** Google's stable account id, which survives an email change. */
  sub: string;
  name: string;
  email: string;
}

/** Both halves or nothing: a lone id would render a button that cannot work. */
export function googleSignInEnabled(): boolean {
  return (
    !!optionalEnv("GOOGLE_CLIENT_ID") && !!optionalEnv("GOOGLE_CLIENT_SECRET")
  );
}

/** Must match the console's registered URI exactly, hence built from env. */
export function googleRedirectUri(): string {
  return `${requireEnv("APP_BASE_URL").replace(/\/$/, "")}/api/auth/google/callback`;
}

export function newOAuthState(): string {
  return randomBytes(16).toString("hex");
}

export function googleAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    // Lets a person with several accounts pick, instead of silently reusing one.
    prompt: "select_account",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

function unb64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

/** Straight from Google's token endpoint over TLS, so the claims need no signature check. */
export function profileFromIdToken(
  idToken: unknown,
  clientId: string,
  nowMs = Date.now(),
): GoogleProfile | null {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(unb64url(parts[1])) as Record<string, unknown>;
    if (!ISSUERS.has(String(claims.iss))) return null;
    if (claims.aud !== clientId) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs)
      return null;
    if (claims.email_verified !== true) return null;
    const sub = typeof claims.sub === "string" ? claims.sub : "";
    const email =
      typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    if (!sub || !email) return null;
    const name =
      (typeof claims.name === "string" && claims.name.trim()) ||
      [claims.given_name, claims.family_name]
        .filter((v) => typeof v === "string" && v.trim())
        .join(" ") ||
      email.slice(0, email.indexOf("@"));
    return { sub, name, email };
  } catch {
    return null;
  }
}

/** Never throws: a failed exchange sends the person back to book as a guest. */
export async function googleProfileForCode(
  code: string,
): Promise<GoogleProfile | null> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[google] token exchange refused:", res.status);
      return null;
    }
    const json = (await res.json()) as { id_token?: unknown };
    return profileFromIdToken(json.id_token, clientId);
  } catch (err) {
    console.error("[google] token exchange failed:", err);
    return null;
  }
}
