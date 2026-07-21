import { beforeEach, describe, expect, it } from "vitest";
import { loadDb } from "../helpers/app";

type Db = Awaited<ReturnType<typeof loadDb>>;
let db: Db;

const D = "2026-07-16";
const at = (t: string) => `${D}T${t}`;

// A confirmed booth-1 reservation over [start, end).
async function reserve(
  start: string,
  end: string,
  over?: Partial<Parameters<Db["createReservation"]>[0]>,
) {
  return db.createReservation({
    boothId: "booth-1",
    startsAt: at(start),
    endsAt: at(end),
    userId: "u1",
    fullName: "Ada",
    ...over,
  });
}

beforeEach(async () => {
  db = await loadDb();
});

describe("createReservation + overlap", () => {
  it("stores a confirmed reservation and lists it in reservedRanges", async () => {
    const r = await reserve("10:00", "11:00");
    expect(r.status).toBe("confirmed");
    expect(r.id).toBeTruthy();

    const ranges = await db.reservedRanges("booth-1", D);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({
      startsAt: at("10:00"),
      endsAt: at("11:00"),
      userId: "u1",
      reservedBy: "Ada",
    });
  });

  it("rejects an overlapping range atomically", async () => {
    await reserve("10:00", "11:00");
    await expect(reserve("10:30", "11:30")).rejects.toBeInstanceOf(
      db.SlotUnavailableError,
    );
    // the loser did not persist
    expect(await db.reservedRanges("booth-1", D)).toHaveLength(1);
  });

  it("allows touching, half-open ranges (11:00 end vs 11:00 start)", async () => {
    await reserve("10:00", "11:00");
    await expect(reserve("11:00", "12:00")).resolves.toBeTruthy();
  });

  it("does not clash across different booths", async () => {
    await reserve("10:00", "11:00");
    await expect(
      reserve("10:00", "11:00", { boothId: "booth-2" }),
    ).resolves.toBeTruthy();
  });

  it("a pending reservation holds the slot just like a confirmed one", async () => {
    await reserve("13:00", "14:00");
    await db.createReservation(
      {
        boothId: "booth-1",
        startsAt: at("15:00"),
        endsAt: at("17:00"),
        userId: "u1",
      },
      "pending",
    );
    await expect(reserve("15:30", "16:00")).rejects.toBeInstanceOf(
      db.SlotUnavailableError,
    );
  });
});

describe("queryReservations", () => {
  it("paginates, counts, filters and scopes by user", async () => {
    await reserve("09:00", "09:30", { userId: "u1" });
    await reserve("10:00", "10:30", { userId: "u2", fullName: "Bob" });
    await db.createReservation(
      {
        boothId: "booth-2",
        startsAt: at("11:00"),
        endsAt: at("13:30"),
        userId: "u1",
      },
      "pending",
    );

    const all = await db.queryReservations();
    expect(all.total).toBe(3);
    expect(all.counts).toMatchObject({ total: 3, confirmed: 2, pending: 1 });

    const pendingOnly = await db.queryReservations({ filter: "pending" });
    expect(pendingOnly.total).toBe(1);

    const mine = await db.queryReservations({ userId: "u1" });
    expect(mine.total).toBe(2);
    // Member-scoped list omits the global tallies (no info-disclosure, no scan).
    expect(mine.counts).toBeUndefined();

    const searchBob = await db.queryReservations({ search: "bob" });
    expect(searchBob.total).toBe(1);

    const firstPage = await db.queryReservations({ pageSize: 2, page: 1 });
    expect(firstPage.reservations).toHaveLength(2);
    expect(firstPage.pageSize).toBe(2);
  });

  it("hides soft-deleted rows from the default view", async () => {
    const r = await reserve("10:00", "11:00");
    await db.updateReservationStatus(r.id, "deleted");
    expect((await db.queryReservations()).total).toBe(0);
    expect((await db.queryReservations({ filter: "deleted" })).total).toBe(1);
  });
});

describe("status update + delete guard", () => {
  it("updates status and returns the row, or null for a missing id", async () => {
    const r = await reserve("10:00", "11:00");
    const updated = await db.updateReservationStatus(r.id, "cancelled");
    expect(updated?.status).toBe("cancelled");
    expect(await db.updateReservationStatus("nope", "cancelled")).toBeNull();
  });

  it("hard-deletes only soft-deleted rows", async () => {
    const live = await reserve("10:00", "11:00");
    expect(await db.deleteReservations([live.id])).toBe(0); // not deleted yet

    await db.updateReservationStatus(live.id, "deleted");
    expect(await db.deleteReservations([live.id])).toBe(1);
    expect(await db.getReservation(live.id)).toBeNull();
    expect(await db.deleteReservations([])).toBe(0);
  });
});
