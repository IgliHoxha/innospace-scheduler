import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { requireAdmin, requireSession, sessionFrom } from "@/lib/api-auth";
import { makeRequest, adminToken } from "../helpers/app";
import { createSessionToken, type Session } from "@/lib/auth";

const req = (token?: string) =>
  makeRequest("http://localhost/api/x", { token });

// A cookie from the account era: correctly signed, but no longer a valid role.
const retiredMemberToken = () =>
  createSessionToken({
    role: "user",
    sub: "u1",
    name: "Ada",
  } as unknown as Session);

describe("api-auth guards", () => {
  it("sessionFrom returns the session for a valid cookie, null otherwise", () => {
    expect(sessionFrom(req(adminToken()))?.sub).toBe("admin");
    expect(sessionFrom(req())).toBeNull();
    expect(sessionFrom(req("garbage.token"))).toBeNull();
  });

  it("requireSession allows a signed-in admin and 401s otherwise", () => {
    expect(requireSession(req(adminToken()))).not.toBeInstanceOf(NextResponse);

    const denied = requireSession(req());
    expect(denied).toBeInstanceOf(NextResponse);
    expect((denied as NextResponse).status).toBe(401);
  });

  it("requireAdmin allows admins but 401s anonymous callers", () => {
    expect(requireAdmin(req(adminToken()))).not.toBeInstanceOf(NextResponse);
    expect(requireAdmin(req())).toBeInstanceOf(NextResponse);
  });

  it("refuses a retired member cookie on both guards", () => {
    const tok = retiredMemberToken();
    expect(sessionFrom(req(tok))).toBeNull();
    expect(requireSession(req(tok))).toBeInstanceOf(NextResponse);
    expect(requireAdmin(req(tok))).toBeInstanceOf(NextResponse);
  });
});
