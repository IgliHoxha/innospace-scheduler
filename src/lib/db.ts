// SQLite (better-sqlite3) DB on the persistent volume. One file, indexed, ACID.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  RESERVATION_STATUSES,
  ACTIVE_STATUSES,
  type Reservation,
  type ReservationInput,
  type ReservationStatus,
} from "./types";
import { requireEnv } from "./env-app";

const COLS =
  "id,createdAt,updatedAt,status,fullName,email,boothId,startsAt,endsAt,note";

const inList = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
const TABLE_BODY = `(
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (${inList(RESERVATION_STATUSES)})),
  fullName TEXT, email TEXT,
  boothId TEXT NOT NULL,
  startsAt TEXT NOT NULL,
  endsAt TEXT NOT NULL,
  note TEXT
)`;

type Row = Record<string, string | number | null>;

const ACTIVE_LIST = inList(ACTIVE_STATUSES);

/** Thrown when a requested slot range overlaps an existing active reservation. */
export class SlotUnavailableError extends Error {
  constructor(message = "That time slot is no longer available.") {
    super(message);
    this.name = "SlotUnavailableError";
  }
}

/** This email already holds an active reservation overlapping this time (any booth). */
export class UserBusyError extends Error {
  constructor(message = "You already have a reservation during that time.") {
    super(message);
    this.name = "UserBusyError";
  }
}

// The whole schema, created on connect. No migration runner: changing a column means wiping the file.
function initSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS reservations ${TABLE_BODY};`);
  // Serves the dashboard's ORDER BY: reverse-scanned, so LIMIT stops early without a sort.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reservations_order ON reservations(startsAt, createdAt);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reservations_slot ON reservations(boothId, startsAt, status);`,
  );
}

// Lazy singleton opened on first query, with its statement cache, so neither outlives the other.
let _db: Database.Database | null = null;
let _stmts: Map<string, Database.Statement> | null = null;
function getDb(): Database.Database {
  if (_db) return _db;
  const dbFile = requireEnv("DATA_FILE");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  initSchema(db);
  _db = db;
  _stmts = new Map();
  return db;
}

// A statement compiled once per connection; static SQL only, or the cache fills with one-offs.
function prep(sql: string): Database.Statement {
  const db = getDb();
  let stmt = _stmts!.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    _stmts!.set(sql, stmt);
  }
  return stmt;
}

function insert(r: Reservation) {
  prep(
    `INSERT INTO reservations (${COLS}) VALUES (@id,@createdAt,@updatedAt,@status,@fullName,@email,@boothId,@startsAt,@endsAt,@note)`,
  ).run(toRow(r));
}

function toRow(r: Reservation): Row {
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    status: r.status,
    fullName: r.fullName ?? null,
    email: r.email ?? null,
    boothId: r.boothId ?? "",
    startsAt: r.startsAt ?? "",
    endsAt: r.endsAt ?? "",
    note: r.note ?? null,
  };
}

function fromRow(r: Row): Reservation {
  const s = (v: string | number | null) => (v == null ? undefined : String(v));
  return {
    id: String(r.id),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt ?? r.createdAt),
    status: String(r.status) as ReservationStatus,
    fullName: s(r.fullName),
    email: s(r.email),
    boothId: s(r.boothId),
    startsAt: s(r.startsAt),
    endsAt: s(r.endsAt),
    note: s(r.note),
  };
}

export interface ReservationCounts {
  total: number;
  pending: number;
  confirmed: number;
  cancelled: number;
  deleted: number;
}

export interface ReservationPage {
  reservations: Reservation[];
  total: number; // rows matching the current filter + search
  page: number; // 1-based
  pageSize: number;
  counts: ReservationCounts; // global tallies for the admin stat boxes
}

export interface ReservationQuery {
  filter?: "all" | ReservationStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

const SEARCH_COLS = ["fullName", "email", "boothId", "note"];

function reservationCounts(): ReservationCounts {
  const r = prep(
    `SELECT
         SUM(CASE WHEN status != 'deleted' THEN 1 ELSE 0 END) AS total,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted
       FROM reservations`,
  ).get() as Record<string, number | null>;
  return {
    total: Number(r.total ?? 0),
    pending: Number(r.pending ?? 0),
    confirmed: Number(r.confirmed ?? 0),
    cancelled: Number(r.cancelled ?? 0),
    deleted: Number(r.deleted ?? 0),
  };
}

/** Paginated, filtered, searchable list for the dashboard. */
export async function queryReservations(
  q: ReservationQuery = {},
): Promise<ReservationPage> {
  const db = getDb();
  const page = Math.max(1, Math.trunc(q.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(q.pageSize ?? 25)));

  const where: string[] = [];
  const params: (string | number)[] = [];

  // "all" (or unset) hides soft-deleted; any explicit status filters to it.
  if (!q.filter || q.filter === "all") {
    where.push("status != 'deleted'");
  } else {
    where.push("status = ?");
    params.push(q.filter);
  }

  const search = (q.search ?? "").trim().toLowerCase();
  if (search) {
    const like = `%${search}%`;
    where.push(
      "(" +
        SEARCH_COLS.map((c) => `LOWER(IFNULL(${c}, '')) LIKE ?`).join(" OR ") +
        ")",
    );
    SEARCH_COLS.forEach(() => params.push(like));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM reservations ${whereSql}`)
      .get(...params) as { n: number }
  ).n;

  // Most imminent-looking first: latest reservation time, then creation.
  const rows = db
    .prepare(
      `SELECT * FROM reservations ${whereSql} ORDER BY startsAt DESC, createdAt DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Row[];

  return {
    reservations: rows.map(fromRow),
    total,
    page,
    pageSize,
    counts: reservationCounts(),
  };
}

/** Active reservations for a booth on a day; the date is a datetime prefix, so the index is used. */
export async function reservedRanges(
  boothId: string,
  date: string,
): Promise<
  {
    startsAt: string;
    endsAt: string;
    reservedBy: string | null;
  }[]
> {
  const rows = prep(
    `SELECT startsAt, endsAt, fullName AS reservedBy
       FROM reservations
       WHERE boothId = ? AND startsAt BETWEEN ? AND ? AND status IN (${ACTIVE_LIST})
       ORDER BY startsAt`,
  ).all(boothId, `${date}T00:00`, `${date}T23:59`) as Row[];
  return rows.map((r) => ({
    startsAt: String(r.startsAt),
    endsAt: String(r.endsAt),
    reservedBy: r.reservedBy == null ? null : String(r.reservedBy),
  }));
}

/** What this email already holds that day, across every booth, since a run can span booths. */
export async function heldRangesForEmail(
  email: string,
  date: string,
): Promise<{ startsAt: string; endsAt: string }[]> {
  const rows = prep(
    `SELECT startsAt, endsAt
       FROM reservations
       WHERE LOWER(email) = ? AND startsAt BETWEEN ? AND ? AND status IN (${ACTIVE_LIST})
       ORDER BY startsAt`,
  ).all(email.toLowerCase(), `${date}T00:00`, `${date}T23:59`) as Row[];
  return rows.map((r) => ({
    startsAt: String(r.startsAt),
    endsAt: String(r.endsAt),
  }));
}

/** Create a reservation; the overlap check and insert share a transaction, so racers can't both win. */
export async function createReservation(
  input: ReservationInput,
  status: Extract<ReservationStatus, "confirmed" | "pending"> = "confirmed",
): Promise<Reservation> {
  const db = getDb();
  const now = new Date().toISOString();
  const reservation: Reservation = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status,
  };

  const tx = db.transaction((r: Reservation) => {
    // Half-open, so touching edges don't clash; the day-start bound keeps the scan off all history.
    const dayStart = `${r.startsAt!.slice(0, 10)}T00:00`;
    const clash = prep(
      `SELECT 1 FROM reservations
         WHERE boothId = ? AND status IN (${ACTIVE_LIST})
           AND startsAt >= ? AND startsAt < ? AND endsAt > ?
         LIMIT 1`,
    ).get(r.boothId, dayStart, r.endsAt, r.startsAt);
    if (clash) throw new SlotUnavailableError();
    // Self-overlap: one person can't hold two booths at once, keyed on the email they booked with.
    if (r.email) {
      const selfClash = prep(
        `SELECT 1 FROM reservations
           WHERE LOWER(email) = ? AND status IN (${ACTIVE_LIST})
             AND startsAt >= ? AND startsAt < ? AND endsAt > ?
           LIMIT 1`,
      ).get(r.email.toLowerCase(), dayStart, r.endsAt, r.startsAt);
      if (selfClash) throw new UserBusyError();
    }
    insert(r);
  });

  tx(reservation);
  return reservation;
}

/** Hard-delete, only for undoing a booking whose confirmation failed: it must free the slot at once. */
export async function discardReservation(id: string): Promise<boolean> {
  const res = prep("DELETE FROM reservations WHERE id = ?").run(id);
  return res.changes > 0;
}

/** Permanently remove rows, guarded to soft-deleted ones only. Returns the count removed. */
export async function deleteReservations(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const res = db
    .prepare(
      `DELETE FROM reservations WHERE status = 'deleted' AND id IN (${placeholders})`,
    )
    .run(...ids);
  return res.changes;
}

export async function getReservation(id: string): Promise<Reservation | null> {
  const row = prep("SELECT * FROM reservations WHERE id = ?").get(id) as
    Row | undefined;
  return row ? fromRow(row) : null;
}

export async function updateReservationStatus(
  id: string,
  status: ReservationStatus,
): Promise<Reservation | null> {
  // RETURNING hands back the updated row in one round-trip; no match -> undefined.
  const row = prep(
    "UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ? RETURNING *",
  ).get(status, new Date().toISOString(), id) as Row | undefined;
  return row ? fromRow(row) : null;
}
