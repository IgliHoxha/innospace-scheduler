import { beforeEach, describe, expect, it } from "vitest";
import { loadDb } from "../helpers/app";
import { CORRECT } from "../helpers/fixtures";
import { verifyPassword } from "@/lib/auth";

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
