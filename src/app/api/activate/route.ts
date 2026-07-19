import { NextRequest, NextResponse } from "next/server";
import { activateUser, getUserById, AlreadyActivatedError } from "@/lib/db";
import { MAX_NAME, MIN_PASSWORD, MAX_PASSWORD } from "@/lib/types";
import {
  verifyInviteToken,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Complete an invite: the member sets their name + password. Identity comes from
 * the signed invite token, not the body. On success we sign them straight in.
 */
export async function POST(req: NextRequest) {
  const { token, name, password } = (await req.json().catch(() => ({}))) as {
    token?: string;
    name?: string;
    password?: string;
  };

  const userId = verifyInviteToken(token);
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "This invite link is invalid or has expired." },
      { status: 400 },
    );
  }

  const fullName = typeof name === "string" ? name.trim() : "";
  const pass = typeof password === "string" ? password : "";
  if (!fullName) {
    return NextResponse.json(
      { ok: false, error: "Please enter your name." },
      { status: 400 },
    );
  }
  if (fullName.length > MAX_NAME) {
    return NextResponse.json(
      {
        ok: false,
        error: `Your name must be ${MAX_NAME} characters or fewer.`,
      },
      { status: 400 },
    );
  }
  // Cap the length before hashing: scrypt on an unbounded password burns CPU.
  if (pass.length < MIN_PASSWORD || pass.length > MAX_PASSWORD) {
    return NextResponse.json(
      {
        ok: false,
        error: `Password must be between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters.`,
      },
      { status: 400 },
    );
  }

  try {
    const user = await activateUser(userId, fullName, pass);
    const res = NextResponse.json({ ok: true, role: "user" });
    res.cookies.set(
      SESSION_COOKIE,
      createSessionToken({
        role: "user",
        sub: user.id,
        name: user.name,
        email: user.email,
      }),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      },
    );
    return res;
  } catch (err) {
    if (err instanceof AlreadyActivatedError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 409 },
      );
    }
    console.error("[activate] POST failed:", err);
    return NextResponse.json(
      { ok: false, error: "This invite is no longer valid." },
      { status: 400 },
    );
  }
}

/** Validate a token and return the invited email, so the page can prefill it. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const userId = verifyInviteToken(token);
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "This invite link is invalid or has expired." },
      { status: 400 },
    );
  }
  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "This invite is no longer valid." },
      { status: 404 },
    );
  }
  if (user.activated) {
    return NextResponse.json(
      { ok: false, error: "This account is already set up. Please sign in." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, email: user.email });
}
