import { NextResponse } from "next/server";
import { optionalEnv } from "./env-app";

/** ALLOWED_ORIGINS parsed; defaults to "*" (allow any) when unset (optional flag). */
function allowedOrigins(): string[] {
  return (optionalEnv("ALLOWED_ORIGINS") ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * In-app origin gate (CORS headers are browser-enforced; this actually blocks).
 * "*" allows all; a disallowed Origin/Referer is rejected; a missing one can't
 * be enforced, so it's allowed and left to the session guard.
 */
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
 * Origin guard for mutating handlers (CSRF defense in depth with the sameSite=lax
 * cookie): 403 when the Origin/Referer isn't allowed, else null. No-op when
 * ALLOWED_ORIGINS is unset ("*"); even when set, a missing origin passes.
 */
export function requireAllowedOrigin(headers: Headers): NextResponse | null {
  if (isOriginAllowed(requestOrigin(headers))) return null;
  return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
}

/** Resolve the CORS headers for a given request origin against ALLOWED_ORIGINS. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = allowedOrigins();

  const allowAll = allowed.includes("*");
  const allowOrigin =
    allowAll || (origin && allowed.includes(origin)) ? origin || "*" : "";

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}
