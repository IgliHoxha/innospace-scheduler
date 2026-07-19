import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_PASS,
  ADMIN_USER,
  DEFAULT_ADMIN_PASS,
  DEFAULT_ADMIN_USER,
  PLAINTEXT,
  SIGNING_ALT,
} from "../helpers/fixtures";
import {
  checkAdminCredentials,
  createInviteToken,
  createSessionToken,
  hashPassword,
  inviteTtlDays,
  verifyInviteToken,
  verifyPassword,
  verifySessionToken,
  type Session,
} from "@/lib/auth";

afterEach(() => vi.unstubAllEnvs());

const adminSession: Session = { role: "admin", sub: "admin", name: "admin" };
const userSession: Session = {
  role: "user",
  sub: "u1",
  name: "Ada",
  email: "ada@example.com",
};

describe("session tokens", () => {
  it("round-trips admin and user sessions", () => {
    expect(verifySessionToken(createSessionToken(adminSession))).toEqual(
      adminSession,
    );
    expect(verifySessionToken(createSessionToken(userSession))).toEqual(
      userSession,
    );
  });

  it("rejects a missing, malformed, or unsigned token", () => {
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken("no-dot-here")).toBeNull();
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const tok = createSessionToken(userSession);
    const [body, sig] = tok.split(".");
    const flipped = (body[0] === "a" ? "b" : "a") + body.slice(1);
    expect(verifySessionToken(`${flipped}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    expect(verifySessionToken(createSessionToken(userSession, -10))).toBeNull();
  });

  it("is scoped by AUTH_SECRET (a token minted under a different secret fails)", () => {
    const tok = createSessionToken(userSession);
    vi.stubEnv("AUTH_SECRET", SIGNING_ALT);
    expect(verifySessionToken(tok)).toBeNull();
  });
});

describe("invite tokens", () => {
  it("round-trips the invited user id", () => {
    expect(verifyInviteToken(createInviteToken("u42"))).toBe("u42");
  });

  it("cannot be replayed as a session, nor a session as an invite", () => {
    expect(verifySessionToken(createInviteToken("u42"))).toBeNull();
    expect(verifyInviteToken(createSessionToken(userSession))).toBeNull();
  });

  it("rejects an expired invite", () => {
    expect(verifyInviteToken(createInviteToken("u42", -10))).toBeNull();
  });

  it("reads INVITE_TTL_DAYS, defaulting to 2", () => {
    expect(inviteTtlDays()).toBe(2);
    vi.stubEnv("INVITE_TTL_DAYS", "5");
    expect(inviteTtlDays()).toBe(5);
    vi.stubEnv("INVITE_TTL_DAYS", "0");
    expect(inviteTtlDays()).toBe(2); // invalid falls back
  });
});

describe("admin credentials", () => {
  it("matches the configured env credentials only", () => {
    vi.stubEnv("DASHBOARD_USERNAME", ADMIN_USER);
    vi.stubEnv("DASHBOARD_PASSWORD", ADMIN_PASS);
    expect(checkAdminCredentials(ADMIN_USER, ADMIN_PASS)).toBe(true);
    expect(checkAdminCredentials(ADMIN_USER, "wrong")).toBe(false);
    expect(checkAdminCredentials("", "")).toBe(false);
  });

  it("falls back to the admin/change-me defaults", () => {
    expect(checkAdminCredentials(DEFAULT_ADMIN_USER, DEFAULT_ADMIN_PASS)).toBe(
      true,
    );
  });
});

describe("password hashing (scrypt)", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword(PLAINTEXT);
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword(PLAINTEXT, stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("salts: the same password hashes differently each time", () => {
    expect(hashPassword("pw")).not.toBe(hashPassword("pw"));
  });

  it("rejects a malformed stored value", () => {
    expect(verifyPassword("pw", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("pw", "")).toBe(false);
  });
});
