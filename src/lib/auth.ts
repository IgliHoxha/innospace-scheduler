import { createHmac, timingSafeEqual } from "crypto";
import { requireEnv } from "./env-app";

export const SESSION_COOKIE = "innospace_scheduler_session";

// The token carries its own expiry, so a longer cookie max-age gains nothing.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

// A booker signs in to save typing, so their session outlives the admin's.
export const MEMBER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export const ROLES = ["admin", "member"] as const;

/** "admin" is the dashboard login; "member" is a booker signed in with Google. */
export type Role = (typeof ROLES)[number];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export interface Session {
  role: Role;
  /** "admin" for the one admin; Google's stable account id for a member. */
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
  if (!safeEqual(token.slice(dot + 1), sign(body))) return null;
  return body;
}

function seal(payload: object): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function createSessionToken(
  session: Session,
  ttlSeconds = SESSION_TTL_SECONDS,
): string {
  const payload: TokenPayload = {
    ...session,
    exp: Date.now() + ttlSeconds * 1000,
  };
  return seal(payload);
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
    if (!isRole(payload.role)) return null;
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

// The session HMAC scheme, purpose-scoped, so neither replays as the other.

type CancelPurpose = "cancel" | "cancel-series";

interface CancelPayload {
  sub: string; // the reservation id, or the series id
  purpose: CancelPurpose;
  exp: number;
}

function sealCancel(sub: string, purpose: CancelPurpose, exp: number): string {
  const payload: CancelPayload = { sub, purpose, exp };
  return seal(payload);
}

function verifyCancel(
  token: string | undefined | null,
  purpose: CancelPurpose,
): string | null {
  const body = verifiedBody(token);
  if (!body) return null;

  try {
    const payload = JSON.parse(unb64url(body)) as CancelPayload;
    if (payload?.purpose !== purpose) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now())
      return null;
    return String(payload.sub);
  } catch {
    return null;
  }
}

/** Expires with the slot: a passed booking cannot be cancelled. */
export function createCancelToken(
  reservationId: string,
  expiresAtMs: number,
): string {
  return sealCancel(reservationId, "cancel", expiresAtMs);
}

export function verifyCancelToken(
  token: string | undefined | null,
): string | null {
  return verifyCancel(token, "cancel");
}

/** Names a weekly series; expires when its last date ends. */
export function createSeriesCancelToken(
  seriesId: string,
  expiresAtMs: number,
): string {
  return sealCancel(seriesId, "cancel-series", expiresAtMs);
}

export function verifySeriesCancelToken(
  token: string | undefined | null,
): string | null {
  return verifyCancel(token, "cancel-series");
}

/** Constant-time compare; length goes first, and length is not secret. */
export function safeEqual(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
