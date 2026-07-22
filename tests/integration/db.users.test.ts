import { beforeEach, describe, expect, it } from "vitest";
import { loadDb } from "../helpers/app";
import { CORRECT } from "../helpers/fixtures";
import { verifyPassword } from "@/lib/auth";

const NEW_PASS = "brand-new-fixture-pass";

type Db = Awaited<ReturnType<typeof loadDb>>;
let db: Db;

beforeEach(async () => {
  db = await loadDb();
});

describe("inviteUser", () => {
  it("creates a pending (not-yet-activated) shell record", async () => {
    const u = await db.inviteUser("Member@Example.com");
    expect(u.email).toBe("member@example.com"); // lowercased
    expect(u.name).toBe("");
    expect(u.activated).toBe(false);
  });

  it("re-invites the same pending record instead of duplicating", async () => {
    const a = await db.inviteUser("x@example.com");
    const b = await db.inviteUser("X@EXAMPLE.COM");
    expect(b.id).toBe(a.id);
    expect(await db.listUsers()).toHaveLength(1);
  });

  it("rejects inviting an already-activated email", async () => {
    const u = await db.inviteUser("x@example.com");
    await db.activateUser(u.id, "Ada", CORRECT);
    await expect(db.inviteUser("x@example.com")).rejects.toBeInstanceOf(
      db.DuplicateEmailError,
    );
  });
});

describe("activateUser", () => {
  it("sets name + password and marks the member activated", async () => {
    const u = await db.inviteUser("x@example.com");
    const active = await db.activateUser(u.id, "  Ada Lovelace  ", CORRECT);
    expect(active.activated).toBe(true);
    expect(active.name).toBe("Ada Lovelace"); // trimmed

    const rec = await db.findUserByEmail("X@EXAMPLE.COM");
    expect(rec?.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword(CORRECT, rec!.passwordHash)).toBe(true);
  });

  it("refuses to activate twice (link can't be reused)", async () => {
    const u = await db.inviteUser("x@example.com");
    await db.activateUser(u.id, "Ada", CORRECT);
    await expect(db.activateUser(u.id, "Ada2", CORRECT)).rejects.toBeInstanceOf(
      db.AlreadyActivatedError,
    );
  });

  it("throws for a missing/deleted invite", async () => {
    await expect(db.activateUser("ghost-id", "Ada", CORRECT)).rejects.toThrow();
  });
});

describe("resetPassword", () => {
  it("replaces an activated member's password (old fails, new works)", async () => {
    const u = await db.inviteUser("x@example.com");
    await db.activateUser(u.id, "Ada", CORRECT);

    const updated = await db.resetPassword(u.id, NEW_PASS);
    expect(updated.activated).toBe(true);

    const rec = await db.findUserByEmail("x@example.com");
    expect(verifyPassword(NEW_PASS, rec!.passwordHash)).toBe(true);
    expect(verifyPassword(CORRECT, rec!.passwordHash)).toBe(false);
  });

  it("changes the stored hash, so a prior reset token's fingerprint is spent", async () => {
    const u = await db.inviteUser("x@example.com");
    await db.activateUser(u.id, "Ada", CORRECT);
    const before = (await db.findUserRecordById(u.id))!.passwordHash;
    await db.resetPassword(u.id, NEW_PASS);
    const after = (await db.findUserRecordById(u.id))!.passwordHash;
    expect(after).not.toBe(before);
  });

  it("throws for a not-yet-activated invite (no password to reset)", async () => {
    const u = await db.inviteUser("x@example.com");
    await expect(db.resetPassword(u.id, NEW_PASS)).rejects.toThrow();
  });

  it("throws for a missing/deleted user", async () => {
    await expect(db.resetPassword("ghost-id", NEW_PASS)).rejects.toThrow();
  });
});

describe("findUserRecordById", () => {
  it("returns the record with hash for an activated member", async () => {
    const u = await db.inviteUser("x@example.com");
    await db.activateUser(u.id, "Ada", CORRECT);
    const rec = await db.findUserRecordById(u.id);
    expect(rec?.email).toBe("x@example.com");
    expect(verifyPassword(CORRECT, rec!.passwordHash)).toBe(true);
  });

  it("returns an empty hash for a pending invite, and null when unknown", async () => {
    const u = await db.inviteUser("x@example.com");
    expect((await db.findUserRecordById(u.id))?.passwordHash).toBe("");
    expect(await db.findUserRecordById("ghost-id")).toBeNull();
  });
});

describe("lookups + delete + ordering", () => {
  it("findUserByEmail returns null for an unknown email", async () => {
    expect(await db.findUserByEmail("nobody@example.com")).toBeNull();
  });

  it("getUserById + deleteUser", async () => {
    const u = await db.inviteUser("x@example.com");
    expect((await db.getUserById(u.id))?.email).toBe("x@example.com");
    expect(await db.deleteUser(u.id)).toBe(true);
    expect(await db.deleteUser(u.id)).toBe(false); // already gone
    expect(await db.getUserById(u.id)).toBeNull();
  });

  it("listUsers sorts activated (named) members before pending invites", async () => {
    await db.inviteUser("pending@example.com");
    const a = await db.inviteUser("active@example.com");
    await db.activateUser(a.id, "Zoe", CORRECT);

    expect((await db.listUsers()).map((u) => u.email)).toEqual([
      "active@example.com",
      "pending@example.com",
    ]);
  });
});
