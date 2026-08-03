// Cookie auth: an HMAC-signed token proving the admin signed in with the env
// credentials, verified on each request. Booking needs no account, so the admin
// is the only session there is.
import { createHmac, timingSafeEqual } from "crypto";
import { requireEnv } from "./env-app";

export const SESSION_COOKIE = "innospace_scheduler_session";

// Sessions expire after this long. The signed token carries its own expiry, so
// a leaked cookie stops working after TTL even if its max-age is tampered with.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type Role = "admin";

export interface Session {
  role: Role;
  /** Always "admin": kept so the token shape stays self-describing. */
  sub: string;
  name: string;
  email?: string;
}

interface TokenPayload extends Session {
  exp: number;
}

function secret(): string {
  return requireEnv("AUTH_SECRET");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function unb64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

/** Constant-time check that `token` is `<body>.<hmac>`, returning the body. */
function verifiedBody(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return body;
}

/** Mint a token of the form `<base64url(payload)>.<hmac>`, signed over the payload. */
export function createSessionToken(
  session: Session,
  ttlSeconds = SESSION_TTL_SECONDS,
): string {
  const payload: TokenPayload = {
    ...session,
    exp: Date.now() + ttlSeconds * 1000,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(
  token: string | undefined | null,
): Session | null {
  const body = verifiedBody(token);
  if (!body) return null;

  try {
    const payload = JSON.parse(unb64url(body)) as TokenPayload;
    if (!payload || typeof payload.exp !== "number") return null;
    if (payload.exp <= Date.now()) return null;
    if (payload.role !== "admin") return null;
    return {
      role: payload.role,
      sub: String(payload.sub),
      name: String(payload.name),
      email: payload.email ? String(payload.email) : undefined,
    };
  } catch {
    return null;
  }
}

// ---- Cancel tokens ---------------------------------------------------------
// The link in a confirmation email, letting the person who booked cancel without
// an account. Same HMAC scheme as sessions but purpose-scoped, so a session
// cookie can't be replayed as a cancel link or the other way round.

interface CancelPayload {
  sub: string; // the reservation id
  purpose: "cancel";
  exp: number;
}

/**
 * Mint a cancel link token. `expiresAtMs` is the reservation's end time, so the
 * link dies exactly when the booking does: a past slot can't be cancelled anyway.
 */
export function createCancelToken(
  reservationId: string,
  expiresAtMs: number,
): string {
  const payload: CancelPayload = {
    sub: reservationId,
    purpose: "cancel",
    exp: expiresAtMs,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Verify a cancel token, returning the reservation id, or null. */
export function verifyCancelToken(
  token: string | undefined | null,
): string | null {
  const body = verifiedBody(token);
  if (!body) return null;

  try {
    const payload = JSON.parse(unb64url(body)) as CancelPayload;
    if (payload?.purpose !== "cancel") return null;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now())
      return null;
    return String(payload.sub);
  } catch {
    return null;
  }
}

function safeEqual(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Verify admin credentials against the env-configured username/password.
export function checkAdminCredentials(
  username: string,
  password: string,
): boolean {
  if (!username || !password) return false;
  const expectedUser = requireEnv("DASHBOARD_USERNAME");
  const expectedPass = requireEnv("DASHBOARD_PASSWORD");
  // Evaluate both (no short-circuit) so timing doesn't reveal which failed.
  const userOk = safeEqual(username, expectedUser);
  const passOk = safeEqual(password, expectedPass);
  return userOk && passOk;
}
