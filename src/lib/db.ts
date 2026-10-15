import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  RESERVATION_STATUSES,
  ACTIVE_STATUSES,
  type ActiveStatus,
  type CountedReservationPage,
  type Reservation,
  type ReservationCounts,
  type ReservationFilter,
  type ReservationInput,
  type ReservationPage,
  type ReservationStatus,
} from "./types";
import { requireEnv } from "./env-app";
import { canonicalEmail } from "./guest";
import { PAGE_SIZE } from "./pagination";
import { USER_BUSY_MESSAGE } from "./reservation-rules";
import { formatDateLong } from "./datetime";

const COLS =
  "id,createdAt,updatedAt,status,fullName,email,boothId,startsAt,endsAt,note,seriesId";

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
  note TEXT,
  seriesId TEXT
)`;

type Row = Record<string, string | number | null>;
type BookedRange = { startsAt: string; endsAt: string };

const startOfDay = (date: string): string => `${date}T00:00`;
const endOfDay = (date: string): string => `${date}T23:59`;
const toRange = (r: Row): BookedRange => ({
  startsAt: String(r.startsAt),
  endsAt: String(r.endsAt),
});
const heldBy =
  (mailbox: string) =>
  (r: Row): boolean =>
    canonicalEmail(String(r.email ?? "")) === mailbox;

const ACTIVE_LIST = inList(ACTIVE_STATUSES);

export class SlotUnavailableError extends Error {
  constructor(message = "That time slot is no longer available.") {
    super(message);
    this.name = "SlotUnavailableError";
  }
}

export class UserBusyError extends Error {
  constructor(message = USER_BUSY_MESSAGE) {
    super(message);
    this.name = "UserBusyError";
  }
}

// A nullable column can be added in place; anything else still means a wipe.
function ensureColumn(db: Database.Database, name: string, decl: string) {
  const cols = db.pragma("table_info(reservations)") as { name: string }[];
  if (cols.some((c) => c.name === name)) return;
  db.exec(`ALTER TABLE reservations ADD COLUMN ${name} ${decl};`);
}

// No migrations: a column change means wiping the DB file.
function initSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS reservations ${TABLE_BODY};`);
  ensureColumn(db, "seriesId", "TEXT");
  // Serves every lookup by day, which the public board runs on each visit.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reservations_order ON reservations(startsAt, createdAt);`,
  );
  // Serves the dashboard's ORDER BY, so LIMIT stops early without a sort.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reservations_newest ON reservations(createdAt, startsAt);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reservations_slot ON reservations(boothId, startsAt, status);`,
  );
  // Serves "cancel all remaining dates", which walks one series at a time.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reservations_series ON reservations(seriesId, startsAt);`,
  );
}

// Lazy singleton with its statement cache, so neither outlives the other.
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

// Compiled once per connection; static SQL only, or the cache fills up.
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
    `INSERT INTO reservations (${COLS}) VALUES (@id,@createdAt,@updatedAt,@status,@fullName,@email,@boothId,@startsAt,@endsAt,@note,@seriesId)`,
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
    seriesId: r.seriesId ?? null,
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
    seriesId: s(r.seriesId),
  };
}

export interface ReservationQuery {
  filter?: ReservationFilter;
  search?: string;
  page?: number;
  pageSize?: number;
  /** Stat-box tallies; they move only on a write, so paging skips the scan. */
  withCounts?: boolean;
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

/** Omitting `withCounts` types the tallies as present, hence the overload. */
export function queryReservations(
  q?: Omit<ReservationQuery, "withCounts">,
): CountedReservationPage;
export function queryReservations(q: ReservationQuery): ReservationPage;

export function queryReservations(q: ReservationQuery = {}): ReservationPage {
  const db = getDb();
  const page = Math.max(1, Math.trunc(q.page ?? 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Math.trunc(q.pageSize ?? PAGE_SIZE)),
  );

  const where: string[] = [];
  const params: (string | number)[] = [];

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

  // Never empty: the status clause above is pushed on every path.
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM reservations ${whereSql}`)
      .get(...params) as { n: number }
  ).n;

  // Newest request on top: "latest" means asked for last, not booked for latest.
  const rows = db
    .prepare(
      `SELECT * FROM reservations ${whereSql} ORDER BY createdAt DESC, startsAt DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as Row[];

  return {
    reservations: rows.map(fromRow),
    total,
    page,
    pageSize,
    // Five whole-table aggregates, too costly for a keystroke or a page click.
    counts: q.withCounts === false ? undefined : reservationCounts(),
  };
}

/** The date is a prefix of startsAt, so the index serves the day range. */
export function reservedRanges(boothId: string, date: string): BookedRange[] {
  // Times only: this feeds the public board, so no name ever leaves the row.
  const rows = prep(
    `SELECT startsAt, endsAt
       FROM reservations
       WHERE boothId = ? AND startsAt BETWEEN ? AND ? AND status IN (${ACTIVE_LIST})
       ORDER BY startsAt`,
  ).all(boothId, startOfDay(date), endOfDay(date)) as Row[];
  return rows.map(toRange);
}

/** A booth with no active reservation that day is absent from the map. */
export function reservationCountsByBooth(date: string): Map<string, number> {
  const rows = prep(
    `SELECT boothId, COUNT(*) AS n
       FROM reservations
       WHERE startsAt BETWEEN ? AND ? AND status IN (${ACTIVE_LIST})
       GROUP BY boothId`,
  ).all(startOfDay(date), endOfDay(date)) as Row[];
  return new Map(rows.map((r) => [String(r.boothId), Number(r.n)]));
}

/** What this email holds that day, across booths, since a run can span them. */
export function heldRangesForEmail(email: string, date: string): BookedRange[] {
  // A day's rows are few, and SQL cannot strip Gmail's dots.
  const rows = prep(
    `SELECT email, startsAt, endsAt
       FROM reservations
       WHERE startsAt BETWEEN ? AND ? AND status IN (${ACTIVE_LIST})
       ORDER BY startsAt`,
  ).all(startOfDay(date), endOfDay(date)) as Row[];
  return rows.filter(heldBy(canonicalEmail(email))).map(toRange);
}

// Must run inside a transaction, so the check and the insert cannot be split.
function insertIfFree(r: Reservation): void {
  // Half-open, so edges do not clash; the day bound skips older history.
  const dayStart = startOfDay(r.startsAt!.slice(0, 10));
  const clash = prep(
    `SELECT 1 FROM reservations
       WHERE boothId = ? AND status IN (${ACTIVE_LIST})
         AND startsAt >= ? AND startsAt < ? AND endsAt > ?
       LIMIT 1`,
  ).get(r.boothId, dayStart, r.endsAt, r.startsAt);
  if (clash) throw new SlotUnavailableError();
  // One person cannot hold two booths at once, keyed on their mailbox.
  if (r.email) {
    const want = canonicalEmail(r.email);
    const overlapping = prep(
      `SELECT email FROM reservations
         WHERE status IN (${ACTIVE_LIST})
           AND startsAt >= ? AND startsAt < ? AND endsAt > ?`,
    ).all(dayStart, r.endsAt, r.startsAt) as Row[];
    const selfClash = overlapping.some(heldBy(want));
    if (selfClash) throw new UserBusyError();
  }
  insert(r);
}

/** Check and insert share a transaction, so racers cannot both win. */
export function createReservation(
  input: ReservationInput,
  status: ActiveStatus = "confirmed",
): Reservation {
  return createReservationSeries([{ input, status }])[0];
}

// The same class again, so the route's instanceof checks still hold.
function namingDate(err: Error, startsAt: string): Error {
  const message = `${formatDateLong(startsAt.slice(0, 10))}: ${err.message}`;
  return err instanceof SlotUnavailableError
    ? new SlotUnavailableError(message)
    : new UserBusyError(message);
}

/** All dates or none: a clash on any one rolls the whole series back. */
export function createReservationSeries(
  entries: readonly { input: ReservationInput; status: ActiveStatus }[],
): Reservation[] {
  const db = getDb();
  const now = new Date().toISOString();
  const seriesId = entries.length > 1 ? randomUUID() : undefined;
  const reservations: Reservation[] = entries.map(({ input, status }) => ({
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status,
    seriesId,
  }));

  const tx = db.transaction((rows: Reservation[]) => {
    for (const r of rows) {
      try {
        insertIfFree(r);
      } catch (err) {
        const refusal =
          err instanceof SlotUnavailableError || err instanceof UserBusyError;
        // A single booking names no date: the person is looking at it.
        if (refusal && seriesId) throw namingDate(err, r.startsAt!);
        throw err;
      }
    }
  });

  tx(reservations);
  return reservations;
}

/** Every date of one series, first to last, whatever its status. */
export function seriesReservations(seriesId: string): Reservation[] {
  const rows = prep(
    "SELECT * FROM reservations WHERE seriesId = ? ORDER BY startsAt",
  ).all(seriesId) as Row[];
  return rows.map(fromRow);
}

/** Cancels the dates still ahead; a date already started is left as it is. */
export function cancelSeriesFrom(
  seriesId: string,
  fromDateTime: string,
): Reservation[] {
  const rows = prep(
    `UPDATE reservations SET status = 'cancelled', updatedAt = ?
       WHERE seriesId = ? AND status IN (${ACTIVE_LIST}) AND startsAt >= ?
       RETURNING *`,
  ).all(new Date().toISOString(), seriesId, fromDateTime) as Row[];
  return rows
    .map(fromRow)
    .sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
}

/** Hard delete, only for a booking whose confirmation email failed. */
export function discardReservation(id: string): boolean {
  const res = prep("DELETE FROM reservations WHERE id = ?").run(id);
  return res.changes > 0;
}

export function deleteReservations(ids: string[]): number {
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

export function getReservation(id: string): Reservation | null {
  const row = prep("SELECT * FROM reservations WHERE id = ?").get(id) as
    Row | undefined;
  return row ? fromRow(row) : null;
}

export function updateReservationStatus(
  id: string,
  status: ReservationStatus,
): Reservation | null {
  const row = prep(
    "UPDATE reservations SET status = ?, updatedAt = ? WHERE id = ? RETURNING *",
  ).get(status, new Date().toISOString(), id) as Row | undefined;
  return row ? fromRow(row) : null;
}
