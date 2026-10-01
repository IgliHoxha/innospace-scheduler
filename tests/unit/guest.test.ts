import { describe, expect, it } from "vitest";
import {
  canonicalEmail,
  guestProblems,
  isValidEmail,
  validateGuest,
} from "@/lib/guest";
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

  it("rejects a dot that opens, closes or doubles up", () => {
    for (const e of [
      "ada..lovelace@example.com",
      ".ada@example.com",
      "ada.@example.com",
      "ada@example..com",
    ]) {
      expect(isValidEmail(e)).toBe(false);
    }
  });

  it("rejects a domain label starting or ending with a hyphen", () => {
    expect(isValidEmail("ada@-example.com")).toBe(false);
    expect(isValidEmail("ada@example-.com")).toBe(false);
    expect(isValidEmail("ada@ex_ample.com")).toBe(false);
    // A hyphen inside a label is legitimate and must survive.
    expect(isValidEmail("ada@my-example.com")).toBe(true);
  });

  it("rejects a TLD that is not all letters, the usual typo", () => {
    expect(isValidEmail("ada@example.c0m")).toBe(false);
    expect(isValidEmail("ada@example.123")).toBe(false);
    expect(isValidEmail("ada@example.co-uk")).toBe(false);
  });

  it("rejects a local part over the RFC 5321 limit of 64", () => {
    expect(isValidEmail(`${"a".repeat(64)}@example.com`)).toBe(true);
    expect(isValidEmail(`${"a".repeat(65)}@example.com`)).toBe(false);
  });

  it("rejects a domain over the RFC 5321 limit of 255", () => {
    // Labels of 60 so no single one is oversized: only the whole domain is.
    const domain = `${Array(5).fill("a".repeat(60)).join(".")}.com`;
    expect(domain.length).toBeGreaterThan(255);
    expect(isValidEmail(`ada@${domain}`)).toBe(false);
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

// The form shows no message, so it has to mark every failing field in one go.
describe("guestProblems", () => {
  it("finds nothing wrong with a full name and a valid email", () => {
    expect(guestProblems(ok)).toEqual({});
  });

  it("names both fields when both are empty", () => {
    expect(guestProblems({ fullName: "", email: "" })).toEqual({
      fullName: "Please enter your full name.",
      email: "Please enter your email.",
    });
    expect(Object.keys(guestProblems({}))).toEqual(["fullName", "email"]);
  });

  it("names only the name when the email is fine", () => {
    expect(guestProblems({ ...ok, fullName: "Ada" })).toEqual({
      fullName: "Please enter your first and last name.",
    });
    expect(Object.keys(guestProblems({ ...ok, fullName: "   " }))).toEqual([
      "fullName",
    ]);
  });

  it("names only the email when the name is fine", () => {
    expect(guestProblems({ ...ok, email: "ada@example" })).toEqual({
      email: "Please enter a valid email address.",
    });
    expect(Object.keys(guestProblems({ ...ok, email: "" }))).toEqual(["email"]);
  });

  it("names a bad email beside a bad name, each with its own reason", () => {
    expect(
      guestProblems({ fullName: "Ada", email: "ada@example.c0m" }),
    ).toEqual({
      fullName: "Please enter your first and last name.",
      email: "Please check the part after the @ in your email.",
    });
  });

  it("gives the same reason validateGuest gives for the field it stops on", () => {
    for (const input of [
      { fullName: "", email: "" },
      { fullName: "Ada", email: "nope" },
      { fullName: "x".repeat(MAX_NAME) + " y", email: "ada@example.com" },
      { ...ok, email: "a".repeat(MAX_EMAIL) + "@example.com" },
      { ...ok, email: "ada lovelace@example.com" },
    ]) {
      const first = bad(input);
      expect(guestProblems(input)[first.field]).toBe(first.error);
    }
  });

  it("treats non-string input as missing, like the route does", () => {
    expect(Object.keys(guestProblems({ fullName: 7, email: null }))).toEqual([
      "fullName",
      "email",
    ]);
  });

  // Agreement with the route's validator: marked fields exist exactly when it refuses.
  it("marks something exactly when validateGuest refuses", () => {
    for (const fullName of ["", "Ada", "Ada Lovelace", "  A  B  "]) {
      for (const email of ["", "x", "ada@example.com", "ADA@Example.COM "]) {
        const refused = !validateGuest({ fullName, email }).ok;
        const marked = Object.keys(guestProblems({ fullName, email })).length;
        expect(marked > 0).toBe(refused);
      }
    }
  });
});
