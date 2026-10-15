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

function indexColumns(file: string, index: string): string[] {
  const d = new Database(file);
  const rows = d.pragma(`index_info(${index})`) as { name: string }[];
  d.close();
  return rows.map((r) => r.name);
}

function queryPlan(file: string, sql: string): string {
  const d = new Database(file);
  const rows = d.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as {
    detail: string;
  }[];
  d.close();
  return rows.map((r) => r.detail).join("\n");
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
        "idx_reservations_newest",
        "idx_reservations_slot",
      ]),
    );
  });

  it("indexes the request time first, which is what the dashboard sorts by", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;
    db.queryReservations({});
    expect(indexColumns(file, "idx_reservations_newest")).toEqual([
      "createdAt",
      "startsAt",
    ]);
    expect(indexColumns(file, "idx_reservations_order")).toEqual([
      "startsAt",
      "createdAt",
    ]);
  });

  it("reads the dashboard's list off that index, with no sort step", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;
    db.queryReservations({});
    for (const where of ["status != 'deleted'", "status = 'pending'"]) {
      const plan = queryPlan(
        file,
        `SELECT * FROM reservations WHERE ${where} ORDER BY createdAt DESC, startsAt DESC LIMIT 25 OFFSET 0`,
      );
      expect(plan).toContain("idx_reservations_newest");
      expect(plan).not.toContain("TEMP B-TREE");
    }
  });

  it("still serves a day's lookups from the slot-time index", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;
    db.queryReservations({});
    const plan = queryPlan(
      file,
      "SELECT email FROM reservations WHERE startsAt BETWEEN '2026-07-16T00:00' AND '2026-07-16T23:59' ORDER BY startsAt",
    );
    expect(plan).toContain("idx_reservations_order");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  it("adds the new index to a database made before it existed, keeping the rows", async () => {
    resetApp();
    const file = process.env.DATA_FILE as string;

    // The schema as it was: the table and the two older indexes only.
    const old = new Database(file);
    old.exec(`
      CREATE TABLE reservations (
        id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
        status TEXT NOT NULL, fullName TEXT, email TEXT, boothId TEXT NOT NULL,
        startsAt TEXT NOT NULL, endsAt TEXT NOT NULL, note TEXT
      );
      CREATE INDEX idx_reservations_order ON reservations(startsAt, createdAt);
      CREATE INDEX idx_reservations_slot ON reservations(boothId, startsAt, status);
      INSERT INTO reservations VALUES
        ('a', '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z', 'confirmed', 'Asked first', 'a@example.com', 'booth-1', '2026-07-20T16:00', '2026-07-20T17:00', NULL),
        ('b', '2026-07-02T08:00:00.000Z', '2026-07-02T08:00:00.000Z', 'confirmed', 'Asked last', 'b@example.com', 'booth-1', '2026-07-10T09:00', '2026-07-10T10:00', NULL);
    `);
    old.close();
    expect(indexNames(file)).not.toContain("idx_reservations_newest");

    const db = await import("@/lib/db");
    const page = db.queryReservations({});

    expect(indexNames(file)).toContain("idx_reservations_newest");
    expect(page.reservations.map((r) => r.fullName)).toEqual([
      "Asked last",
      "Asked first",
    ]);
  });

  it("adds the series column and its index to a database made before them, keeping the rows", async () => {
    resetApp();
    const file = process.env.DATA_FILE as string;

    // The schema as it was: no seriesId column, no series index.
    const old = new Database(file);
    old.exec(`
      CREATE TABLE reservations (
        id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
        status TEXT NOT NULL, fullName TEXT, email TEXT, boothId TEXT NOT NULL,
        startsAt TEXT NOT NULL, endsAt TEXT NOT NULL, note TEXT
      );
      INSERT INTO reservations VALUES
        ('a', '2026-07-01T08:00:00.000Z', '2026-07-01T08:00:00.000Z', 'confirmed', 'Kept', 'a@example.com', 'booth-1', '2026-07-20T16:00', '2026-07-20T17:00', NULL);
    `);
    old.close();
    expect(columnNames(file, "reservations")).not.toContain("seriesId");

    const db = await import("@/lib/db");
    const page = db.queryReservations({});

    expect(columnNames(file, "reservations")).toContain("seriesId");
    expect(indexNames(file)).toContain("idx_reservations_series");
    expect(indexColumns(file, "idx_reservations_series")).toEqual([
      "seriesId",
      "startsAt",
    ]);
    expect(page.reservations.map((r) => r.fullName)).toEqual(["Kept"]);
    expect(page.reservations[0].seriesId).toBeUndefined();

    // The old row and a new series live side by side.
    const made = db.createReservationSeries(
      [21, 28].map((d) => ({
        input: {
          ...seed,
          startsAt: `2026-07-${d}T14:00`,
          endsAt: `2026-07-${d}T15:00`,
        },
        status: "confirmed" as const,
      })),
    );
    expect(db.seriesReservations(made[0].seriesId!)).toHaveLength(2);
  });

  it("walks a series off its own index", async () => {
    const db = await loadDb();
    const file = process.env.DATA_FILE as string;
    db.queryReservations({});
    const plan = queryPlan(
      file,
      "SELECT * FROM reservations WHERE seriesId = 's1' ORDER BY startsAt",
    );
    expect(plan).toContain("idx_reservations_series");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  // Booking is login-less, so there is nobody to store.
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

    new Database(file).close();
    expect(tableNames(file)).not.toContain("reservations");

    const db = await import("@/lib/db");
    db.queryReservations({}); // initSchema runs on first access

    expect(tableNames(file)).toContain("reservations");
  });
});
