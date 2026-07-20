import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { requireAdmin, requireSession, sessionFrom } from "@/lib/api-auth";
import { makeRequest, adminToken, userToken } from "../helpers/app";

const req = (token?: string) =>
  makeRequest("http://localhost/api/x", { token });

describe("api-auth guards", () => {
  it("sessionFrom returns the session for a valid cookie, null otherwise", () => {
    expect(sessionFrom(req(userToken("u1")))?.sub).toBe("u1");
    expect(sessionFrom(req())).toBeNull();
    expect(sessionFrom(req("garbage.token"))).toBeNull();
  });

  it("requireSession allows any signed-in user and 401s otherwise", () => {
    const ok = requireSession(req(userToken("u1")));
    expect(ok).not.toBeInstanceOf(NextResponse);

    const denied = requireSession(req());
    expect(denied).toBeInstanceOf(NextResponse);
    expect((denied as NextResponse).status).toBe(401);
  });

  it("requireAdmin allows admins but 401s members and anonymous", () => {
    expect(requireAdmin(req(adminToken()))).not.toBeInstanceOf(NextResponse);

    const memberDenied = requireAdmin(req(userToken("u1")));
    expect(memberDenied).toBeInstanceOf(NextResponse);
    expect((memberDenied as NextResponse).status).toBe(401);

    expect(requireAdmin(req())).toBeInstanceOf(NextResponse);
  });
});
