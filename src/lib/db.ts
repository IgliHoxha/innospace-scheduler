// SQLite (better-sqlite3) DB on the persistent volume. One file, indexed, ACID.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { RESERVATION_STATUSES } from "./types";
import type {
  Reservation,
  ReservationInput,
  ReservationStatus,
  User,
  UserRecord,
} from "./types";
import { hashPassword } from "./auth";

const DB_FILE =
  process.env.DATA_FILE || path.join(process.cwd(), "data", "scheduler.db");

const COLS =
  "id,createdAt,status,source,fullName,email,phoneNumber,boothId,startsAt,endsAt,note,userId";

const inList = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
const TABLE_BODY = `(
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (${inList(RESERVATION_STATUSES)})),
  source TEXT,
  fullName TEXT, email TEXT, phoneNumber TEXT,
  boothId TEXT NOT NULL,
  startsAt TEXT NOT NULL,
  endsAt TEXT NOT NULL,
  note TEXT,
  userId TEXT
)`;

// name and passwordHash are null for an invited-but-not-yet-activated member;
// they're filled in when the member completes the invite link.
const USERS_TABLE_BODY = `(
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  name TEXT,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT
)`;

type Row = Record<string, string | number | null>;

// Statuses that occupy a slot: a pending (awaiting-approval) booking holds the
// time just like a confirmed one, so nobody else can grab it in the meantime.
const ACTIVE_STATUSES = ["confirmed", "pending"] as const;
const ACTIVE_LIST = inList(ACTIVE_STATUSES);

/** Thrown when a requested slot range overlaps an existing active booking. */
export class SlotUnavailableError extends Error {
  constructor(message = "That time slot is no longer available.") {
    super(message);
    this.name = "SlotUnavailableError";
  }
}

// Ordered schema migrations, keyed by target `PRAGMA user_version`. Each step
// runs exactly once, in a transaction, on any DB whose version is below it, then
// the version is bumped. A fresh DB starts at version 0 and runs them all.
//
// To change the schema: append a new { version: N+1, up } entry with the
// ALTER/CREATE statements — never edit an existing one (it has already run on
// live DBs). Migration 1 is the baseline and uses IF NOT EXISTS so it's a no-op
// on a DB that was created before migrations existed.
type Migration = { version: number; up: (db: Database.Database) => void };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS reservations ${TABLE_BODY};`);
      db.exec(`CREATE TABLE IF NOT EXISTS users ${USERS_TABLE_BODY};`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_reservations_createdAt ON reservations(createdAt);`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_reservations_slot ON reservations(boothId, startsAt, status);`,
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_reservations_userId ON reservations(userId);`,
      );
    },
  },
];

/** The schema version this build expects — the highest migration defined. */
export const SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);

/** Apply any migrations newer than the DB's current `user_version`. */
function migrate(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    // DDL + the version bump in one transaction: a failed migration rolls back
    // wholesale, so we never leave the DB half-migrated.
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
}

// Lazy singleton: open on first query, not at import time (avoids running during build).
let _db: Database.Database | null = null;
function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  _db = db;
  return db;
}

function insert(db: Database.Database, r: Reservation) {
  db.prepare(
    `INSERT INTO reservations (${COLS}) VALUES (@id,@createdAt,@status,@source,@fullName,@email,@phoneNumber,@boothId,@startsAt,@endsAt,@note,@userId)`,
  ).run(toRow(r));
}

function toRow(r: Reservation): Row {
  return {
    id: r.id,
    createdAt: r.createdAt,
    status: r.status,
    source: r.source ?? "website",
    fullName: r.fullName ?? null,
    email: r.email ?? null,
    phoneNumber: r.phoneNumber ?? null,
    boothId: r.boothId ?? "",
    startsAt: r.startsAt ?? "",
    endsAt: r.endsAt ?? "",
    note: r.note ?? null,
    userId: r.userId ?? null,
  };
}

function fromRow(r: Row): Reservation {
  const s = (v: string | number | null) => (v == null ? undefined : String(v));
  return {
    id: String(r.id),
    createdAt: String(r.createdAt),
    status: String(r.status) as ReservationStatus,
    source: s(r.source),
    fullName: s(r.fullName),
    email: s(r.email),
    phoneNumber: s(r.phoneNumber),
    boothId: s(r.boothId),
    startsAt: s(r.startsAt),
    endsAt: s(r.endsAt),
    note: s(r.note),
    userId: s(r.userId),
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
  counts: ReservationCounts; // global tallies for the stat boxes
}

export interface ReservationQuery {
  filter?: "all" | ReservationStatus;
  search?: string;
  page?: number;
  pageSize?: number;
  /** Restrict to a single member's own bookings (the "my bookings" view). */
  userId?: string;
}

const SEARCH_COLS = ["fullName", "email", "phoneNumber", "boothId", "note"];

function reservationCounts(db: Database.Database): ReservationCounts {
  const r = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status != 'deleted' THEN 1 ELSE 0 END) AS total,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
         SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted
       FROM reservations`,
    )
    .get() as Record<string, number | null>;
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

  if (q.userId) {
    where.push("userId = ?");
    params.push(q.userId);
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

  // Most imminent-looking first: latest booking time, then creation.
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
    counts: reservationCounts(db),
  };
}

/**
 * Active (confirmed or pending) bookings for a booth on a day. The date is a
 * prefix of the datetime, so a range scan over startsAt uses the index.
 */
export async function bookedRanges(
  boothId: string,
  date: string,
): Promise<
  {
    startsAt: string;
    endsAt: string;
    bookedBy: string | null;
    userId: string | null;
  }[]
> {
  const rows = getDb()
    .prepare(
      // The member's own name first: a booking keeps the name it was made
      // under, so a rename would leave the old one on the board.
      `SELECT r.startsAt, r.endsAt, r.userId, COALESCE(u.name, r.fullName) AS bookedBy
       FROM reservations r
       LEFT JOIN users u ON u.id = r.userId
       WHERE r.boothId = ? AND r.startsAt BETWEEN ? AND ? AND r.status IN (${ACTIVE_LIST})
       ORDER BY r.startsAt`,
    )
    .all(boothId, `${date}T00:00`, `${date}T23:59`) as Row[];
  return rows.map((r) => ({
    startsAt: String(r.startsAt),
    endsAt: String(r.endsAt),
    bookedBy: r.bookedBy == null ? null : String(r.bookedBy),
    userId: r.userId == null ? null : String(r.userId),
  }));
}

/**
 * Create a reservation. The overlap check and insert share one transaction, so
 * two racers for the same slot can't both win. Pending and confirmed both hold it.
 */
export async function createReservation(
  input: ReservationInput,
  status: Extract<ReservationStatus, "confirmed" | "pending"> = "confirmed",
): Promise<Reservation> {
  const db = getDb();
  const reservation: Reservation = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status,
    source: "website",
  };

  const tx = db.transaction((r: Reservation) => {
    // Overlap: an existing active booking starts before this one ends AND ends
    // after this one starts. Half-open ranges, so touching edges don't clash.
    const clash = db
      .prepare(
        `SELECT 1 FROM reservations
         WHERE boothId = ? AND status IN (${ACTIVE_LIST})
           AND startsAt < ? AND endsAt > ?
         LIMIT 1`,
      )
      .get(r.boothId, r.endsAt, r.startsAt);
    if (clash) throw new SlotUnavailableError();
    insert(db, r);
  });

  tx(reservation);
  return reservation;
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
  const row = getDb()
    .prepare("SELECT * FROM reservations WHERE id = ?")
    .get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

export async function updateReservationStatus(
  id: string,
  status: ReservationStatus,
): Promise<Reservation | null> {
  const db = getDb();
  const res = db
    .prepare("UPDATE reservations SET status = ? WHERE id = ?")
    .run(status, id);
  if (res.changes === 0) return null;
  const row = db.prepare("SELECT * FROM reservations WHERE id = ?").get(id) as
    Row | undefined;
  return row ? fromRow(row) : null;
}

// ---- Users (members) ------------------------------------------------------

function userFromRow(r: Row): User {
  return {
    id: String(r.id),
    createdAt: String(r.createdAt),
    name: r.name == null ? "" : String(r.name),
    email: String(r.email),
    activated: r.passwordHash != null,
  };
}

/** Thrown when the email is already taken by an active member. */
export class DuplicateEmailError extends Error {
  constructor(message = "That email is already a member.") {
    super(message);
    this.name = "DuplicateEmailError";
  }
}

/** Thrown when trying to activate an invite that's already been completed. */
export class AlreadyActivatedError extends Error {
  constructor(message = "This account is already set up. Please sign in.") {
    super(message);
    this.name = "AlreadyActivatedError";
  }
}

export async function listUsers(): Promise<User[]> {
  // Invited (not yet named) members sort last but stay visible.
  const rows = getDb()
    .prepare(
      "SELECT * FROM users ORDER BY (name IS NULL), name COLLATE NOCASE, email COLLATE NOCASE",
    )
    .all() as Row[];
  return rows.map(userFromRow);
}

/**
 * Invite a member by email. An un-activated duplicate is reused (re-invite); an
 * already-active email throws.
 */
export async function inviteUser(emailRaw: string): Promise<User> {
  const db = getDb();
  const email = emailRaw.trim().toLowerCase();
  const existing = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as Row | undefined;

  if (existing) {
    if (existing.passwordHash != null) throw new DuplicateEmailError();
    return userFromRow(existing); // re-invite the pending record
  }

  const user: User = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    name: "",
    email,
    activated: false,
  };
  db.prepare(
    "INSERT INTO users (id,createdAt,name,email,passwordHash) VALUES (@id,@createdAt,NULL,@email,NULL)",
  ).run({ id: user.id, createdAt: user.createdAt, email });
  return user;
}

/**
 * Complete an invite: set the member's name + password. Fails if the user is
 * gone (deleted) or already activated, so a link can't be used twice.
 */
export async function activateUser(
  userId: string,
  name: string,
  password: string,
): Promise<User> {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
    Row | undefined;
  if (!row) throw new Error("This invite is no longer valid.");
  if (row.passwordHash != null) throw new AlreadyActivatedError();

  db.prepare("UPDATE users SET name = ?, passwordHash = ? WHERE id = ?").run(
    name.trim(),
    hashPassword(password),
    userId,
  );
  return userFromRow(
    db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Row,
  );
}

export async function deleteUser(id: string): Promise<boolean> {
  const res = getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
  return res.changes > 0;
}

export async function getUserById(id: string): Promise<User | null> {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as
    Row | undefined;
  return row ? userFromRow(row) : null;
}

/** For login: returns the full record (incl. hash) matching an email. */
export async function findUserByEmail(
  email: string,
): Promise<UserRecord | null> {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as Row | undefined;
  if (!row) return null;
  // Empty hash for a not-yet-activated invite: verifyPassword will reject it.
  return {
    ...userFromRow(row),
    passwordHash: row.passwordHash == null ? "" : String(row.passwordHash),
  };
}
