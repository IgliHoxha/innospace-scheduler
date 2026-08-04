import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  ADMIN_PASS,
  ADMIN_USER,
  DEFAULT_ADMIN_PASS,
  DEFAULT_ADMIN_USER,
  SIGNING_ALT,
} from "../helpers/fixtures";
import {
  checkAdminCredentials,
  createCancelToken,
  createSessionToken,
  verifyCancelToken,
  verifySessionToken,
  type Session,
} from "@/lib/auth";

afterEach(() => vi.unstubAllEnvs());

const adminSession: Session = { role: "admin", sub: "admin", name: "admin" };
const withEmail: Session = {
  role: "admin",
  sub: "admin",
  name: "Ada",
  email: "ada@example.com",
};

const inAnHour = () => Date.now() + 60 * 60 * 1000;

describe("session tokens", () => {
  it("round-trips an admin session, with and without an email", () => {
    expect(verifySessionToken(createSessionToken(adminSession))).toEqual(
      adminSession,
    );
    expect(verifySessionToken(createSessionToken(withEmail))).toEqual(
      withEmail,
    );
  });

  it("rejects a missing, malformed, or unsigned token", () => {
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken("no-dot-here")).toBeNull();
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const tok = createSessionToken(adminSession);
    const [body, sig] = tok.split(".");
    const flipped = (body[0] === "a" ? "b" : "a") + body.slice(1);
    expect(verifySessionToken(`${flipped}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    expect(
      verifySessionToken(createSessionToken(adminSession, -10)),
    ).toBeNull();
  });

  it("rejects any role but admin, so an old member cookie is dead", () => {
    // Minted by hand: the current API can't express the retired "user" role.
    const forged = createSessionToken({
      ...adminSession,
      role: "user",
    } as unknown as Session);
    expect(verifySessionToken(forged)).toBeNull();
  });

  it("is scoped by AUTH_SECRET (a token minted under a different secret fails)", () => {
    const tok = createSessionToken(adminSession);
    vi.stubEnv("AUTH_SECRET", SIGNING_ALT);
    expect(verifySessionToken(tok)).toBeNull();
  });
});

describe("cancel tokens", () => {
  it("round-trips the reservation id", () => {
    expect(verifyCancelToken(createCancelToken("r42", inAnHour()))).toBe("r42");
  });

  it("cannot be replayed as a session, nor a session as a cancel link", () => {
    expect(verifySessionToken(createCancelToken("r42", inAnHour()))).toBeNull();
    expect(verifyCancelToken(createSessionToken(adminSession))).toBeNull();
  });

  it("expires at the moment it was minted for (the reservation's end)", () => {
    expect(verifyCancelToken(createCancelToken("r42", Date.now() - 1))).toBe(
      null,
    );
    expect(verifyCancelToken(createCancelToken("r42", inAnHour()))).toBe("r42");
  });

  it("rejects a missing, malformed or tampered token", () => {
    expect(verifyCancelToken(null)).toBeNull();
    expect(verifyCancelToken("")).toBeNull();
    expect(verifyCancelToken("no-dot-here")).toBeNull();
    const [body, sig] = createCancelToken("r42", inAnHour()).split(".");
    const flipped = (body[0] === "a" ? "b" : "a") + body.slice(1);
    expect(verifyCancelToken(`${flipped}.${sig}`)).toBeNull();
  });

  it("is scoped by AUTH_SECRET", () => {
    const tok = createCancelToken("r42", inAnHour());
    vi.stubEnv("AUTH_SECRET", SIGNING_ALT);
    expect(verifyCancelToken(tok)).toBeNull();
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

describe("a token whose body is not a payload", () => {
  const signed = (json: string) => {
    const body = Buffer.from(json, "utf8").toString("base64url");
    // Signed correctly, so only the payload check can reject it.
    const mac = createHmac("sha256", process.env.AUTH_SECRET as string)
      .update(body)
      .digest("hex");
    return `${body}.${mac}`;
  };

  it("rejects a session token carrying JSON null", () => {
    expect(verifySessionToken(signed("null"))).toBeNull();
  });

  it("rejects a session token whose body is not JSON at all", () => {
    expect(verifySessionToken(signed("not json"))).toBeNull();
  });

  it("rejects a cancel token carrying JSON null or junk", () => {
    expect(verifyCancelToken(signed("null"))).toBeNull();
    expect(verifyCancelToken(signed("{oops"))).toBeNull();
  });
});
