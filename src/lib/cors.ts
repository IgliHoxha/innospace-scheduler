import { NextResponse } from "next/server";
import { optionalEnv } from "./env-app";

// An in-app origin gate, not CORS headers: those are browser-enforced, this
// actually blocks. A missing Origin/Referer can't be checked, so it passes here
// and is left to the session guard.

/** ALLOWED_ORIGINS parsed; "*" (allow any) when the optional flag is unset. */
function allowedOrigins(): string[] {
  return (optionalEnv("ALLOWED_ORIGINS") ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Is this origin on the allowlist? */
export function isOriginAllowed(origin: string | null): boolean {
  const allowed = allowedOrigins();
  if (allowed.includes("*")) return true;
  if (!origin) return true;
  return allowed.includes(origin);
}

/** The Origin header, falling back to the Referer's origin. */
export function requestOrigin(headers: Headers): string | null {
  const origin = headers.get("origin");
  if (origin) return origin;
  const referer = headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* malformed Referer */
    }
  }
  return null;
}

/**
 * Is the Origin the host we're served from? ALLOWED_ORIGINS describes *other*
 * sites, so the app must never have to list itself there.
 */
function isSameOrigin(origin: string, headers: Headers): boolean {
  const host = headers.get("host");
  if (!host) return false;
  try {
    // Host-only compare: the scheme is terminated at Cloudflare/Fly, so the
    // forwarded request's scheme isn't a reliable match for the browser's.
    return new URL(origin).host === host;
  } catch {
    return false; // malformed Origin
  }
}

/** Should this request pass the origin gate? */
export function isRequestOriginAllowed(headers: Headers): boolean {
  const origin = requestOrigin(headers);
  if (!origin) return true;
  if (isSameOrigin(origin, headers)) return true;
  return isOriginAllowed(origin);
}

/**
 * Guard for mutating handlers, CSRF defence in depth behind the sameSite=lax
 * cookie: a 403 to return as-is, or null. A no-op while ALLOWED_ORIGINS is unset.
 */
export function requireAllowedOrigin(headers: Headers): NextResponse | null {
  if (isRequestOriginAllowed(headers)) return null;
  return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
}
