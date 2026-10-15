import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-response";
import {
  createSessionToken,
  MEMBER_SESSION_TTL_SECONDS,
  safeEqual,
  SESSION_COOKIE,
  type Session,
} from "@/lib/auth";
import { requireEnv } from "@/lib/env-app";
import {
  googleProfileForCode,
  googleSignInEnabled,
  OAUTH_STATE_COOKIE,
} from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function home(path: string): string {
  return `${requireEnv("APP_BASE_URL").replace(/\/$/, "")}${path}`;
}

/** Google answers here; a bad answer books as a guest rather than erroring. */
export async function GET(req: NextRequest) {
  if (!googleSignInEnabled()) return jsonError("Not found", 404);

  const sp = req.nextUrl.searchParams;
  const expected = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  const state = sp.get("state") ?? "";
  const code = sp.get("code") ?? "";

  // The state is single-use either way, so the cookie goes on every path.
  const failed = NextResponse.redirect(home("/?signin=failed"), 302);
  failed.cookies.delete(OAUTH_STATE_COOKIE);
  if (!expected || !state || !safeEqual(state, expected) || !code) {
    return failed;
  }

  const profile = await googleProfileForCode(code);
  if (!profile) return failed;

  const session: Session = {
    role: "member",
    sub: profile.sub,
    name: profile.name,
    email: profile.email,
  };
  const res = NextResponse.redirect(home("/"), 302);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(session, MEMBER_SESSION_TTL_SECONDS),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MEMBER_SESSION_TTL_SECONDS,
    },
  );
  return res;
}
