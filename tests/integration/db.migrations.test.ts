import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { loadDb, resetApp } from "../helpers/app";

// Inspect a DB file directly (outside the app's singleton) to assert on the
// schema version and tables the migration runner produced.
function userVersion(file: string): number {
  const d = new Database(file);
  const v = d.pragma("user_version", { simple: true }) as number;
  d.close();
  return v;
}

function tableNames(file: string): string[] {
  const d = new Database(file);
  const rows = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  d.close();
  return rows.map((r) => r.name);
}

const now = () => new Date().toISOString();

describe("schema migrations", () => {
  it("brings a fresh DB up to SCHEMA_VERSION with the expected tables", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;

    await db.listUsers(); // first query opens the DB and runs migrate()

    expect(db.SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    expect(userVersion(file)).toBe(db.SCHEMA_VERSION);
    expect(tableNames(file)).toEqual(
      expect.arrayContaining(["reservations", "users"]),
    );
  });

  it("re-running migrations is a no-op and preserves existing rows", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;
    await db.listUsers(); // migrate once

    // Write a row, then rebind the module to the SAME file (a fresh "boot").
    const d = new Database(file);
    d.prepare(
      "INSERT INTO users (id, createdAt, name, email, passwordHash) VALUES (?,?,?,?,?)",
    ).run("u1", now(), "Ada", "ada@example.com", "scrypt$aa$bb");
    d.close();

    vi.resetModules();
    process.env.DATA_FILE = file; // same file, new module instance
    const db2 = await import("@/lib/db");

    const users = await db2.listUsers();
    expect(users.map((u) => u.email)).toContain("ada@example.com");
    expect(userVersion(file)).toBe(db2.SCHEMA_VERSION); // not re-bumped/reset
  });

  it("upgrades a pre-migrations DB (tables present, version 0) without data loss", async () => {
    resetApp();
    const file = process.env.DATA_FILE as string;

    // Simulate a DB created before migrations existed: the users table is there
    // but user_version was never set (stays 0), and reservations is missing.
    const d = new Database(file);
    d.exec(
      `CREATE TABLE users (id TEXT PRIMARY KEY, createdAt TEXT, name TEXT, email TEXT UNIQUE, passwordHash TEXT);`,
    );
    d.prepare("INSERT INTO users (id, createdAt, email) VALUES (?,?,?)").run(
      "u0",
      now(),
      "old@example.com",
    );
    d.close();
    expect(userVersion(file)).toBe(0);

    const db = await import("@/lib/db");
    const users = await db.listUsers(); // migrate() runs on first access

    expect(userVersion(file)).toBe(db.SCHEMA_VERSION); // bumped
    expect(tableNames(file)).toEqual(
      expect.arrayContaining(["reservations", "users"]),
    ); // reservations created
    expect(users.map((u) => u.email)).toContain("old@example.com"); // kept
  });
});
