import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-response";
import {
  googleAuthorizeUrl,
  googleSignInEnabled,
  newOAuthState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
} from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sends the person to Google; the state cookie ties the answer to this browser. */
export async function GET() {
  if (!googleSignInEnabled()) return jsonError("Not found", 404);

  const state = newOAuthState();
  const res = NextResponse.redirect(googleAuthorizeUrl(state), 302);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return res;
}
