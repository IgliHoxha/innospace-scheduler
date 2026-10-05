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
  safeEqual,
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

describe("the token wire format", () => {
  const b64 = (json: string) => Buffer.from(json, "utf8").toString("base64url");
  const mac = (body: string) =>
    createHmac("sha256", process.env.AUTH_SECRET as string)
      .update(body)
      .digest("hex");
  const signed = (json: string) => `${b64(json)}.${mac(b64(json))}`;

  afterEach(() => vi.useRealTimers());

  it("mints a session as base64url JSON, a dot, then the hex HMAC of that body", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const exp = Date.now() + 60_000;
    expect(createSessionToken(withEmail, 60)).toBe(
      signed(
        `{"role":"admin","sub":"admin","name":"Ada","email":"ada@example.com","exp":${exp}}`,
      ),
    );
  });

  it("mints a cancel link the same way, with its own field order", () => {
    const exp = inAnHour();
    expect(createCancelToken("r42", exp)).toBe(
      signed(`{"sub":"r42","purpose":"cancel","exp":${exp}}`),
    );
  });

  it("rejects a signature that is short, long, empty, or the right length but wrong", () => {
    const tokens = [
      createSessionToken(adminSession),
      createCancelToken("r42", inAnHour()),
    ];
    for (const tok of tokens) {
      const [body, sig] = tok.split(".");
      const wrong = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
      for (const bad of [sig.slice(1), `${sig}0`, "", wrong, `${sig}.x`]) {
        expect(verifySessionToken(`${body}.${bad}`)).toBeNull();
        expect(verifyCancelToken(`${body}.${bad}`)).toBeNull();
      }
    }
  });

  it("rejects a token with nothing before its first dot", () => {
    const sig = mac("");
    expect(verifySessionToken(`.${sig}`)).toBeNull();
    expect(verifyCancelToken(`.${sig}`)).toBeNull();
  });

  it("rejects a signed payload whose fields cannot be read as strings", () => {
    const exp = inAnHour();
    const hostile = '{"toString":1}';
    expect(
      verifySessionToken(
        signed(`{"role":"admin","exp":${exp},"sub":${hostile},"name":"x"}`),
      ),
    ).toBeNull();
    expect(
      verifyCancelToken(
        signed(`{"purpose":"cancel","exp":${exp},"sub":${hostile}}`),
      ),
    ).toBeNull();
  });

  it("throws on a missing AUTH_SECRET rather than calling the token bad", () => {
    const session = createSessionToken(adminSession);
    const cancel = createCancelToken("r42", inAnHour());
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => verifySessionToken(session)).toThrow(/AUTH_SECRET/);
    expect(() => verifyCancelToken(cancel)).toThrow(/AUTH_SECRET/);
    expect(() => createSessionToken(adminSession)).toThrow(/AUTH_SECRET/);
    expect(() => createCancelToken("r42", inAnHour())).toThrow(/AUTH_SECRET/);
    // No body means no signature to check, so the secret is never read.
    expect(verifySessionToken("no-dot-here")).toBeNull();
    expect(verifyCancelToken("no-dot-here")).toBeNull();
  });
});

describe("safeEqual", () => {
  it("is true only for the identical string", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("answers false, without throwing, when the lengths differ", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abcd", "abc")).toBe(false);
    expect(safeEqual("", "a")).toBe(false);
  });

  it("measures bytes, so one two-byte character is not one ASCII letter", () => {
    expect(safeEqual("é", "é")).toBe(true);
    expect(safeEqual("é", "e")).toBe(false);
    expect(safeEqual("é", "ab")).toBe(false);
  });
});
