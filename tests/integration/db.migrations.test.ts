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

function emailsInUsers(file: string): string[] {
  const d = new Database(file);
  const rows = d.prepare("SELECT email FROM users").all() as {
    email: string;
  }[];
  d.close();
  return rows.map((r) => r.email);
}

const now = () => new Date().toISOString();

const seed = {
  boothId: "booth-1",
  startsAt: "2026-07-16T14:00",
  endsAt: "2026-07-16T15:00",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
};

describe("schema migrations", () => {
  it("brings a fresh DB up to SCHEMA_VERSION with the expected tables", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;

    await db.queryReservations({}); // first query opens the DB and runs migrate()

    expect(db.SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    expect(userVersion(file)).toBe(db.SCHEMA_VERSION);
    // `users` is dead weight from the account era, but migration 1 has shipped,
    // so it must still be created exactly as before.
    expect(tableNames(file)).toEqual(
      expect.arrayContaining(["reservations", "users"]),
    );
  });

  it("re-running migrations is a no-op and preserves existing rows", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;
    await db.createReservation(seed);

    // Rebind the module to the SAME file (a fresh "boot").
    vi.resetModules();
    process.env.DATA_FILE = file;
    const db2 = await import("@/lib/db");

    const page = await db2.queryReservations({});
    expect(page.reservations.map((r) => r.email)).toContain("ada@example.com");
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
    await db.queryReservations({}); // migrate() runs on first access

    expect(userVersion(file)).toBe(db.SCHEMA_VERSION); // bumped
    expect(tableNames(file)).toEqual(
      expect.arrayContaining(["reservations", "users"]),
    ); // reservations created
    expect(emailsInUsers(file)).toContain("old@example.com"); // nothing dropped
  });
});
