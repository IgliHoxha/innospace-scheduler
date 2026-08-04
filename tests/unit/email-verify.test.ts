import { beforeEach, describe, expect, it, vi } from "vitest";

// node:dns is stubbed so no lookup ever leaves the process.
const resolveMx = vi.fn();
const resolve = vi.fn();
vi.mock("node:dns", () => ({ promises: { resolveMx, resolve } }));

type Verify = typeof import("@/lib/email-verify");
let verify: Verify;

/** A DNS error carries its reason in `code`, which is what the branching reads. */
const dnsError = (code: string) =>
  Object.assign(new Error(code), { code }) as NodeJS.ErrnoException;

beforeEach(async () => {
  vi.resetModules();
  resolveMx.mockReset();
  resolve.mockReset();
  verify = await import("@/lib/email-verify");
  verify.resetEmailVerifyCache();
});

describe("checkEmailDeliverable", () => {
  it("accepts a domain with MX records", async () => {
    resolveMx.mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
    await expect(
      verify.checkEmailDeliverable("ada@example.com"),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects a domain that does not exist", async () => {
    resolveMx.mockRejectedValue(dnsError("ENOTFOUND"));
    const r = await verify.checkEmailDeliverable("ada@nope.invalid");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("doesn't accept mail");
  });

  // RFC 7505: a lone "." says the domain takes no mail, outranking any A record. example.com does this.
  it("rejects a null MX even when the domain has an A record", async () => {
    resolveMx.mockResolvedValue([{ exchange: ".", priority: 0 }]);
    resolve.mockResolvedValue(["203.0.113.10"]);
    expect((await verify.checkEmailDeliverable("ada@example.com")).ok).toBe(
      false,
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  // No MX is legal: RFC 5321 falls back to the A record, so this must not reject.
  it("accepts a domain with no MX but an A record", async () => {
    resolveMx.mockRejectedValue(dnsError("ENODATA"));
    resolve.mockResolvedValue(["203.0.113.10"]);
    await expect(
      verify.checkEmailDeliverable("ada@example.com"),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects when there is neither MX nor A", async () => {
    resolveMx.mockRejectedValue(dnsError("ENODATA"));
    resolve.mockRejectedValue(dnsError("ENOTFOUND"));
    expect((await verify.checkEmailDeliverable("ada@example.com")).ok).toBe(
      false,
    );
  });

  // A resolver outage must never stop bookings; the Resend gate still catches a bad address.
  it("fails open when DNS itself cannot answer", async () => {
    resolveMx.mockRejectedValue(dnsError("ETIMEOUT"));
    await expect(
      verify.checkEmailDeliverable("ada@example.com"),
    ).resolves.toEqual({ ok: true });
  });

  it("fails open on SERVFAIL from the A lookup too", async () => {
    resolveMx.mockRejectedValue(dnsError("ENODATA"));
    resolve.mockRejectedValue(dnsError("ESERVFAIL"));
    await expect(
      verify.checkEmailDeliverable("ada@example.com"),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects a disposable provider without any lookup", async () => {
    const r = await verify.checkEmailDeliverable("ada@mailinator.com");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("permanent email");
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it("matches the disposable list case-insensitively", async () => {
    expect((await verify.checkEmailDeliverable("A@MailInator.com")).ok).toBe(
      false,
    );
  });

  it("caches per domain, so a second booking costs no lookup", async () => {
    resolveMx.mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
    await verify.checkEmailDeliverable("ada@example.com");
    await verify.checkEmailDeliverable("grace@example.com");
    expect(resolveMx).toHaveBeenCalledOnce();
  });

  it("caches a rejection too", async () => {
    resolveMx.mockRejectedValue(dnsError("ENOTFOUND"));
    expect((await verify.checkEmailDeliverable("a@nope.invalid")).ok).toBe(
      false,
    );
    expect((await verify.checkEmailDeliverable("b@nope.invalid")).ok).toBe(
      false,
    );
    expect(resolveMx).toHaveBeenCalledOnce();
  });

  // Never cached, so a resolver blip can't pin a domain as good for an hour.
  it("does not cache a fail-open result", async () => {
    resolveMx.mockRejectedValue(dnsError("ETIMEOUT"));
    await verify.checkEmailDeliverable("ada@example.com");
    await verify.checkEmailDeliverable("ada@example.com");
    expect(resolveMx).toHaveBeenCalledTimes(2);
  });
});

describe("disposable domains", () => {
  it("refuses a throwaway inbox before any DNS lookup", async () => {
    const res = await verify.checkEmailDeliverable("ada@mailinator.com");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/permanent email/i);
    // Rejected on the list alone, so no resolver was consulted.
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it("refuses an address with no domain at all", async () => {
    expect((await verify.checkEmailDeliverable("ada@")).ok).toBe(false);
    expect(resolveMx).not.toHaveBeenCalled();
  });
});
