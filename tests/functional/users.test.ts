import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminToken, makeRequest, resetApp, userToken } from "../helpers/app";
import { CORRECT } from "../helpers/fixtures";

vi.mock("@/lib/email", () => ({
  sendReservationEmail: vi.fn().mockResolvedValue(undefined),
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

type Route = typeof import("@/app/api/users/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
let route: Route;
let db: Db;
let email: Email;

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/users/route");
  email = await import("@/lib/email");
});

describe("GET /api/users (admin only)", () => {
  it("401 without an admin session", async () => {
    expect((await route.GET(makeRequest("/api/users"))).status).toBe(401);
    expect(
      (await route.GET(makeRequest("/api/users", { token: userToken("u1") })))
        .status,
    ).toBe(401);
  });

  it("200 lists members for an admin", async () => {
    await db.inviteUser("a@example.com");
    const res = await route.GET(
      makeRequest("/api/users", { token: adminToken() }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      users: { email: string }[];
    };
    expect(body.users.map((u) => u.email)).toContain("a@example.com");
  });
});

describe("POST /api/users - invite (admin only)", () => {
  const invite = (body: unknown, tok?: string) =>
    route.POST(makeRequest("/api/users", { method: "POST", body, token: tok }));

  it("401 for a non-admin", async () => {
    expect(
      (await invite({ email: "a@example.com" }, userToken("u1"))).status,
    ).toBe(401);
  });

  it("400 on a malformed JSON body (parse falls back to empty)", async () => {
    const res = await route.POST(
      makeRequest("/api/users", {
        method: "POST",
        rawBody: "{ not json",
        token: adminToken(),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 for an invalid email", async () => {
    expect((await invite({ email: "not-an-email" }, adminToken())).status).toBe(
      400,
    );
  });

  it("201 invites a new member and sends the invite email", async () => {
    const res = await invite({ email: "new@example.com" }, adminToken());
    expect(res.status).toBe(201);
    expect(email.sendInviteEmail).toHaveBeenCalledOnce();
  });

  it("409 for an already-activated email", async () => {
    const u = await db.inviteUser("dup@example.com");
    await db.activateUser(u.id, "Ada", CORRECT);
    expect(
      (await invite({ email: "dup@example.com" }, adminToken())).status,
    ).toBe(409);
  });

  it("502 when the invite email fails to send (member still created)", async () => {
    vi.mocked(email.sendInviteEmail).mockRejectedValueOnce(
      new Error("smtp down"),
    );
    const res = await invite({ email: "flaky@example.com" }, adminToken());
    expect(res.status).toBe(502);
  });
});
