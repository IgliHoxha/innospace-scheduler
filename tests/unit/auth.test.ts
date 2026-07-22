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
  createResetToken,
  createSessionToken,
  hashPassword,
  inviteTtlDays,
  passwordFingerprint,
  resetTtlMinutes,
  verifyInviteToken,
  verifyPassword,
  verifyResetToken,
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

  it("reads INVITE_TTL_DAYS and rejects invalid values", () => {
    expect(inviteTtlDays()).toBe(2); // baseline
    vi.stubEnv("INVITE_TTL_DAYS", "5");
    expect(inviteTtlDays()).toBe(5);
    vi.stubEnv("INVITE_TTL_DAYS", "0");
    expect(() => inviteTtlDays()).toThrow();
    vi.stubEnv("INVITE_TTL_DAYS", "abc");
    expect(() => inviteTtlDays()).toThrow();
  });
});

describe("password-reset tokens", () => {
  const HASH_A = "scrypt$aaaa$bbbb";
  const HASH_B = "scrypt$cccc$dddd";

  it("round-trips the user id plus the hash fingerprint", () => {
    expect(verifyResetToken(createResetToken("u42", HASH_A))).toEqual({
      userId: "u42",
      fp: passwordFingerprint(HASH_A),
    });
  });

  it("cannot be replayed as a session or invite (and vice versa)", () => {
    const reset = createResetToken("u42", HASH_A);
    expect(verifySessionToken(reset)).toBeNull();
    expect(verifyInviteToken(reset)).toBeNull();
    expect(verifyResetToken(createSessionToken(userSession))).toBeNull();
    expect(verifyResetToken(createInviteToken("u42"))).toBeNull();
  });

  it("rejects a missing, malformed, expired, or tampered token", () => {
    expect(verifyResetToken(null)).toBeNull();
    expect(verifyResetToken("no-dot-here")).toBeNull();
    expect(verifyResetToken(createResetToken("u42", HASH_A, -10))).toBeNull();
    const tok = createResetToken("u42", HASH_A);
    const [body, sig] = tok.split(".");
    const flipped = (body[0] === "a" ? "b" : "a") + body.slice(1);
    expect(verifyResetToken(`${flipped}.${sig}`)).toBeNull();
  });

  it("binds the fingerprint to the hash, so it changes when the password does", () => {
    // The caller compares the embedded fp against the *current* hash; once the
    // password changes the fingerprints diverge and the link is spent.
    expect(passwordFingerprint(HASH_A)).not.toBe(passwordFingerprint(HASH_B));
    const { fp } = verifyResetToken(createResetToken("u42", HASH_A))!;
    expect(fp).toBe(passwordFingerprint(HASH_A));
    expect(fp).not.toBe(passwordFingerprint(HASH_B));
  });

  it("is scoped by AUTH_SECRET", () => {
    const tok = createResetToken("u42", HASH_A);
    vi.stubEnv("AUTH_SECRET", SIGNING_ALT);
    expect(verifyResetToken(tok)).toBeNull();
  });

  it("reads PASSWORD_RESET_TTL_MINUTES and rejects invalid values", () => {
    expect(resetTtlMinutes()).toBe(30); // baseline
    vi.stubEnv("PASSWORD_RESET_TTL_MINUTES", "45");
    expect(resetTtlMinutes()).toBe(45);
    vi.stubEnv("PASSWORD_RESET_TTL_MINUTES", "0");
    expect(() => resetTtlMinutes()).toThrow();
    vi.stubEnv("PASSWORD_RESET_TTL_MINUTES", "abc");
    expect(() => resetTtlMinutes()).toThrow();
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

  it("uses the configured credentials and throws when unset", () => {
    // Baseline sets DASHBOARD_USERNAME/PASSWORD to these.
    expect(checkAdminCredentials(DEFAULT_ADMIN_USER, DEFAULT_ADMIN_PASS)).toBe(
      true,
    );
    vi.stubEnv("DASHBOARD_USERNAME", "");
    expect(() =>
      checkAdminCredentials(DEFAULT_ADMIN_USER, DEFAULT_ADMIN_PASS),
    ).toThrow();
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
