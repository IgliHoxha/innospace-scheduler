import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, resetApp } from "../helpers/app";
import { CORRECT } from "../helpers/fixtures";

vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

type Route = typeof import("@/app/api/forgot-password/route");
type Db = typeof import("@/lib/db");
type Email = typeof import("@/lib/email");
let route: Route;
let db: Db;
let email: Email;

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  email = await import("@/lib/email");
  route = await import("@/app/api/forgot-password/route");
});

const post = (body: unknown) =>
  route.POST(makeRequest("/api/forgot-password", { method: "POST", body }));

async function activatedMember(email = "ada@example.com") {
  const u = await db.inviteUser(email);
  await db.activateUser(u.id, "Ada", CORRECT);
  return u;
}

describe("POST /api/forgot-password", () => {
  it("200 generic reply and no email for an unknown address", async () => {
    const res = await post({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("200 and sends a reset link for an activated member", async () => {
    await activatedMember("ada@example.com");
    const res = await post({ email: "Ada@Example.com" });
    expect(res.status).toBe(200);
    expect(email.sendPasswordResetEmail).toHaveBeenCalledOnce();
    // First arg is the (lowercased) member email.
    expect(vi.mocked(email.sendPasswordResetEmail).mock.calls[0][0]).toBe(
      "ada@example.com",
    );
  });

  it("200 but no email for a not-yet-activated invitee (they use the invite)", async () => {
    await db.inviteUser("pending@example.com");
    const res = await post({ email: "pending@example.com" });
    expect(res.status).toBe(200);
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("200 generic even on a malformed body (no enumeration signal)", async () => {
    const res = await route.POST(
      makeRequest("/api/forgot-password", {
        method: "POST",
        rawBody: "{ not json",
      }),
    );
    expect(res.status).toBe(200);
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("still succeeds when the email send throws (failure isn't leaked)", async () => {
    vi.mocked(email.sendPasswordResetEmail).mockRejectedValueOnce(
      new Error("smtp down"),
    );
    await activatedMember("boom@example.com");
    const res = await post({ email: "boom@example.com" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("stays generic when a member-only step throws (no enumeration on misconfig)", async () => {
    // Reproduces the incident: PASSWORD_RESET_TTL_MINUTES unset made token
    // minting throw for existing members only, so real accounts 500'd while
    // unknown ones got 200 - an enumeration oracle. It must stay a generic 200.
    vi.stubEnv("PASSWORD_RESET_TTL_MINUTES", "");
    await activatedMember("known@example.com");

    const known = await post({ email: "known@example.com" });
    expect(known.status).toBe(200);
    expect((await known.json()).ok).toBe(true);

    const unknown = await post({ email: "stranger@example.com" });
    expect(unknown.status).toBe(200);
    // Same status for member and non-member: nothing distinguishes them.
    expect((await unknown.json()).ok).toBe(true);

    vi.unstubAllEnvs();
  });

  it("429 once the per-IP reset throttle trips", async () => {
    vi.stubEnv("LOGIN_IP_MAX_ATTEMPTS", "2");
    expect((await post({ email: "a@example.com" })).status).toBe(200);
    expect((await post({ email: "a@example.com" })).status).toBe(429);
    const blocked = await post({ email: "a@example.com" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    vi.unstubAllEnvs();
  });
});
