// Cookie auth: an HMAC-signed token carries the role ("admin" via env creds, or
// "user" for DB-stored members) plus subject identity, verified on each request.
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "crypto";
import { requireEnv, requireIntEnv } from "./env-app";

export const SESSION_COOKIE = "innospace_scheduler_session";

// Sessions expire after this long. The signed token carries its own expiry, so
// a leaked cookie stops working after TTL even if its max-age is tampered with.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type Role = "admin" | "user";

export interface Session {
  role: Role;
  /** Admin: "admin". User: the user's id. */
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
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // Constant-time signature check first: order doesn't leak validity.
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(unb64url(body)) as TokenPayload;
    if (!payload || typeof payload.exp !== "number") return null;
    if (payload.exp <= Date.now()) return null;
    if (payload.role !== "admin" && payload.role !== "user") return null;
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

// ---- Invite tokens ---------------------------------------------------------
// A signed, self-expiring token letting a new member set their own name and
// password. Same HMAC scheme as sessions but purpose-scoped, so neither can be
// replayed as the other.

/** How many days an invite link stays valid. Required. Env: INVITE_TTL_DAYS. */
export function inviteTtlDays(): number {
  const v = requireIntEnv("INVITE_TTL_DAYS");
  if (v <= 0) {
    throw new Error("INVITE_TTL_DAYS must be a positive integer.");
  }
  return v;
}

/** The invite TTL in seconds, derived from INVITE_TTL_DAYS. */
export function inviteTtlSeconds(): number {
  return inviteTtlDays() * 24 * 60 * 60;
}

interface InvitePayload {
  sub: string; // the invited user's id
  purpose: "invite";
  exp: number;
}

export function createInviteToken(
  userId: string,
  ttlSeconds = inviteTtlSeconds(),
): string {
  const payload: InvitePayload = {
    sub: userId,
    purpose: "invite",
    exp: Date.now() + ttlSeconds * 1000,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Verify an invite token, returning the invited user's id, or null. */
export function verifyInviteToken(
  token: string | undefined | null,
): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(unb64url(body)) as InvitePayload;
    if (payload?.purpose !== "invite") return null;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now())
      return null;
    return String(payload.sub);
  } catch {
    return null;
  }
}

// ---- Password-reset tokens -------------------------------------------------
// Purpose-scoped like invites, plus bound to a fingerprint of the account's
// current password hash: changing the password breaks the match, so a used or
// stale link dies without any server-side token store.

/** How long a reset link stays valid, in minutes. Required. Env: PASSWORD_RESET_TTL_MINUTES. */
export function resetTtlMinutes(): number {
  const v = requireIntEnv("PASSWORD_RESET_TTL_MINUTES");
  if (v <= 0) {
    throw new Error("PASSWORD_RESET_TTL_MINUTES must be a positive integer.");
  }
  return v;
}

/** The reset TTL in seconds, derived from PASSWORD_RESET_TTL_MINUTES. */
export function resetTtlSeconds(): number {
  return resetTtlMinutes() * 60;
}

/**
 * An opaque, deterministic fingerprint of a stored password hash. Embedded in a
 * reset token and re-derived on use: a mismatch means the password already
 * changed, so the token is spent. Not a secret (it's HMAC'd only to stay opaque).
 */
export function passwordFingerprint(passwordHash: string): string {
  return createHmac("sha256", secret())
    .update(`reset-fp:${passwordHash}`)
    .digest("hex")
    .slice(0, 16);
}

interface ResetPayload {
  sub: string; // the member's id
  purpose: "reset";
  fp: string; // fingerprint of the password hash at issue time
  exp: number;
}

export function createResetToken(
  userId: string,
  passwordHash: string,
  ttlSeconds = resetTtlSeconds(),
): string {
  const payload: ResetPayload = {
    sub: userId,
    purpose: "reset",
    fp: passwordFingerprint(passwordHash),
    exp: Date.now() + ttlSeconds * 1000,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/**
 * Verify a reset token's signature, purpose and expiry, returning the member id
 * and the embedded fingerprint. The caller must still confirm the fingerprint
 * matches the account's current password hash (see passwordFingerprint).
 */
export function verifyResetToken(
  token: string | undefined | null,
): { userId: string; fp: string } | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(unb64url(body)) as ResetPayload;
    if (payload?.purpose !== "reset") return null;
    if (typeof payload.fp !== "string" || !payload.fp) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now())
      return null;
    return { userId: String(payload.sub), fp: payload.fp };
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

// ---- Password hashing (scrypt) for DB-stored users ------------------------

/** Hash a password as `scrypt$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time verify of a password against a stored `scrypt$salt$hash`. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
