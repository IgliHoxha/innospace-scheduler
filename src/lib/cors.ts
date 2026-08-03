import { NextResponse } from "next/server";
import { optionalEnv } from "./env-app";

// An in-app origin gate, not CORS headers: those are browser-enforced, this actually blocks.

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

/** Is the Origin our own host? ALLOWED_ORIGINS describes other sites, never this one. */
function isSameOrigin(origin: string, headers: Headers): boolean {
  const host = headers.get("host");
  if (!host) return false;
  try {
    // Host-only: TLS terminates at Cloudflare, so the forwarded scheme isn't the browser's.
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

/** CSRF defence in depth behind the sameSite cookie: a ready 403, or null. */
export function requireAllowedOrigin(headers: Headers): NextResponse | null {
  if (isRequestOriginAllowed(headers)) return null;
  return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
}
