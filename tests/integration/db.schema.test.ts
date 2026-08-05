import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { loadDb, resetApp } from "../helpers/app";

// Inspect the DB file directly, outside the singleton, to assert initSchema.
function tableNames(file: string): string[] {
  const d = new Database(file);
  const rows = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  d.close();
  return rows.map((r) => r.name);
}

function indexNames(file: string): string[] {
  const d = new Database(file);
  const rows = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all() as { name: string }[];
  d.close();
  return rows.map((r) => r.name);
}

function columnNames(file: string, table: string): string[] {
  const d = new Database(file);
  const rows = d.pragma(`table_info(${table})`) as { name: string }[];
  d.close();
  return rows.map((r) => r.name);
}

const seed = {
  boothId: "booth-1",
  startsAt: "2026-07-16T14:00",
  endsAt: "2026-07-16T15:00",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
};

describe("schema init", () => {
  it("creates the reservations table and its indexes on a fresh DB", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;

    db.queryReservations({}); // first query opens the DB and inits the schema

    expect(tableNames(file)).toContain("reservations");
    expect(indexNames(file)).toEqual(
      expect.arrayContaining([
        "idx_reservations_order",
        "idx_reservations_slot",
      ]),
    );
  });

  // Accounts are gone: booking is login-less, so there is nobody to store.
  it("creates no users table", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;
    db.queryReservations({});
    expect(tableNames(file)).not.toContain("users");
  });

  it("stores identity on the reservation itself, with no userId column", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;
    db.createReservation(seed);

    const cols = columnNames(file, "reservations");
    expect(cols).toEqual(expect.arrayContaining(["fullName", "email"]));
    // Nothing collects a phone: name and email are the whole identity.
    expect(cols).not.toContain("userId");
    expect(cols).not.toContain("phoneNumber");
  });

  it("re-opening an existing DB is a no-op and preserves rows", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;
    db.createReservation(seed);

    // Rebind to the same file: every CREATE is IF NOT EXISTS, so data survives.
    vi.resetModules();
    process.env.DATA_FILE = file;
    const db2 = await import("@/lib/db");

    const page = await db2.queryReservations({});
    expect(page.reservations.map((r) => r.email)).toContain("ada@example.com");
  });

  it("builds the schema inside an empty pre-existing DB file", async () => {
    resetApp();
    const file = process.env.DATA_FILE as string;

    // A file created before the app ever touched it: no tables at all.
    new Database(file).close();
    expect(tableNames(file)).not.toContain("reservations");

    const db = await import("@/lib/db");
    db.queryReservations({}); // initSchema runs on first access

    expect(tableNames(file)).toContain("reservations");
  });
});
