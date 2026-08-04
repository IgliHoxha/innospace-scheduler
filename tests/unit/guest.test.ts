import { describe, expect, it } from "vitest";
import { canonicalEmail, isValidEmail, validateGuest } from "@/lib/guest";
import { MAX_EMAIL, MAX_NAME } from "@/lib/types";

const ok = { fullName: "Ada Lovelace", email: "ada@example.com" };

// Narrow the union so a failing case can assert on `field` without casting.
function bad(input: Parameters<typeof validateGuest>[0]) {
  const r = validateGuest(input);
  if (r.ok) throw new Error("expected validation to fail");
  return r;
}

describe("validateGuest", () => {
  it("accepts a full name and an email", () => {
    const r = validateGuest(ok);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.guest).toEqual({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("trims and collapses inner whitespace", () => {
    const r = validateGuest({
      fullName: "  Ada   \t Lovelace  ",
      email: "  ada@example.com ",
    });
    expect(r.ok && r.guest.fullName).toBe("Ada Lovelace");
    expect(r.ok && r.guest.email).toBe("ada@example.com");
  });

  it("keeps a three-part name intact", () => {
    const r = validateGuest({ ...ok, fullName: "Ada King Lovelace" });
    expect(r.ok && r.guest.fullName).toBe("Ada King Lovelace");
  });

  it("lower-cases the email so one person is one identity", () => {
    const r = validateGuest({ ...ok, email: "Ada@Example.COM" });
    expect(r.ok && r.guest.email).toBe("ada@example.com");
  });

  it("requires a name", () => {
    expect(bad({ ...ok, fullName: "" }).field).toBe("fullName");
    expect(bad({ ...ok, fullName: "   " }).field).toBe("fullName");
  });

  it("requires both a first and a last name", () => {
    const r = bad({ ...ok, fullName: "Ada" });
    expect(r.field).toBe("fullName");
    expect(r.error).toContain("first and last name");
    // Trailing space alone is not a second name: it collapses away first.
    expect(bad({ ...ok, fullName: "Ada  " }).field).toBe("fullName");
  });

  it("requires an email", () => {
    expect(bad({ ...ok, email: "" }).field).toBe("email");
  });

  it("rejects a non-string field rather than coercing it", () => {
    expect(bad({ ...ok, fullName: 42 }).field).toBe("fullName");
    expect(bad({ ...ok, fullName: ["Ada", "Lovelace"] }).field).toBe(
      "fullName",
    );
    expect(bad({ ...ok, email: { toString: () => "a@b.co" } }).field).toBe(
      "email",
    );
  });

  it("caps the name length, so nothing unbounded reaches the DB", () => {
    const atCap = `Ada ${"x".repeat(MAX_NAME - 4)}`;
    expect(atCap.length).toBe(MAX_NAME);
    expect(validateGuest({ ...ok, fullName: atCap }).ok).toBe(true);
    expect(bad({ ...ok, fullName: `${atCap}x` }).field).toBe("fullName");
  });

  it("caps the email length", () => {
    const long = `${"x".repeat(MAX_EMAIL)}@example.com`;
    expect(bad({ ...ok, email: long }).field).toBe("email");
  });

  it("reports the first problem only, in form order", () => {
    expect(bad({ fullName: "", email: "" }).field).toBe("fullName");
    expect(bad({ ...ok, email: "nope" }).field).toBe("email");
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses, including plus tags and subdomains", () => {
    for (const e of [
      "ada@example.com",
      "ada.lovelace@example.co.uk",
      "ada+booth@example.com",
      "ada@mail.example.com",
      "a@b.io",
    ]) {
      expect(isValidEmail(e)).toBe(true);
    }
  });

  it("rejects addresses with no @, no dotted domain, or whitespace", () => {
    for (const e of [
      "",
      "ada",
      "ada@",
      "@example.com",
      "ada@example",
      "ada@example.c",
      "ada lovelace@example.com",
      "ada@exa mple.com",
      "ada@@example.com",
    ]) {
      expect(isValidEmail(e)).toBe(false);
    }
  });
});

describe("canonicalEmail", () => {
  it("ignores dots in a Gmail local part, as Gmail does", () => {
    expect(canonicalEmail("igli.ihoxha@gmail.com")).toBe(
      "igliihoxha@gmail.com",
    );
    expect(canonicalEmail("i.g.l.i.i.h.o.x.h.a@gmail.com")).toBe(
      "igliihoxha@gmail.com",
    );
  });
  it("drops a Gmail plus tag", () => {
    expect(canonicalEmail("igliihoxha+booth@gmail.com")).toBe(
      "igliihoxha@gmail.com",
    );
    expect(canonicalEmail("igli.ihoxha+a.b@gmail.com")).toBe(
      "igliihoxha@gmail.com",
    );
  });
  it("folds googlemail.com onto gmail.com, the same inbox by an older name", () => {
    expect(canonicalEmail("igli.ihoxha@googlemail.com")).toBe(
      "igliihoxha@gmail.com",
    );
    expect(canonicalEmail("igliihoxha+x@googlemail.com")).toBe(
      canonicalEmail("igli.ihoxha@gmail.com"),
    );
  });
  it("drops a plus tag at the other providers that document it", () => {
    expect(canonicalEmail("ada+booth@outlook.com")).toBe("ada@outlook.com");
    expect(canonicalEmail("ada+booth@icloud.com")).toBe("ada@icloud.com");
    expect(canonicalEmail("ada+booth@proton.me")).toBe("ada@proton.me");
    expect(canonicalEmail("ada+booth@fastmail.com")).toBe("ada@fastmail.com");
  });
  it("keeps dots outside Gmail: nobody else ignores them", () => {
    expect(canonicalEmail("igli.ihoxha@outlook.com")).toBe(
      "igli.ihoxha@outlook.com",
    );
    expect(canonicalEmail("a.b@icloud.com")).toBe("a.b@icloud.com");
  });
  it("leaves an unknown domain untouched rather than guessing its rules", () => {
    expect(canonicalEmail("a.b+c@somecompany.al")).toBe("a.b+c@somecompany.al");
    expect(canonicalEmail("a.b+c@innospacetirana.com")).toBe(
      "a.b+c@innospacetirana.com",
    );
  });
  it("trims and lowercases whatever it is given", () => {
    expect(canonicalEmail("  Igli.IHoxha@Gmail.COM ")).toBe(
      "igliihoxha@gmail.com",
    );
  });
  it("keeps the original when canonicalising would empty the local part", () => {
    expect(canonicalEmail("+tag@gmail.com")).toBe("+tag@gmail.com");
    expect(canonicalEmail("...@gmail.com")).toBe("...@gmail.com");
  });
  it("passes through anything without a domain", () => {
    expect(canonicalEmail("nope")).toBe("nope");
    expect(canonicalEmail("")).toBe("");
  });
});
