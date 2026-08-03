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
    email: "ada@example.com",
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
    // Times only: the name must not leave the row for the public board.
    expect(ranges[0]).toEqual({
      startsAt: at("10:00"),
      endsAt: at("11:00"),
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

  it("does not clash across different booths (different people)", async () => {
    await reserve("10:00", "11:00");
    await expect(
      reserve("10:00", "11:00", {
        boothId: "booth-2",
        email: "bob@example.com",
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects the same email overlapping in another booth (no being in two at once)", async () => {
    await reserve("10:00", "11:00"); // ada, booth-1
    await expect(
      reserve("10:30", "11:30", { boothId: "booth-2" }), // ada, booth-2, overlaps
    ).rejects.toBeInstanceOf(db.UserBusyError);
    // adjacent, half-open ranges in another booth are fine for the same person
    await expect(
      reserve("11:00", "12:00", { boothId: "booth-2" }),
    ).resolves.toBeTruthy();
  });

  it("matches the email case-insensitively, so casing can't dodge the rule", async () => {
    await reserve("10:00", "11:00", { email: "Ada@Example.com" });
    await expect(
      reserve("10:30", "11:30", {
        boothId: "booth-2",
        email: "ada@example.COM",
      }),
    ).rejects.toBeInstanceOf(db.UserBusyError);
  });

  it("a cancelled reservation does not block a new booking", async () => {
    const r = await reserve("10:00", "11:00");
    await db.updateReservationStatus(r.id, "cancelled");
    await expect(
      reserve("10:00", "11:00", { boothId: "booth-2" }),
    ).resolves.toBeTruthy();
  });

  it("does not apply the self-overlap rule when there is no email", async () => {
    await reserve("10:00", "11:00", { email: undefined });
    await expect(
      reserve("10:30", "11:30", { boothId: "booth-2", email: undefined }),
    ).resolves.toBeTruthy();
  });

  it("a pending reservation holds the slot just like a confirmed one", async () => {
    await reserve("13:00", "14:00");
    await db.createReservation(
      {
        boothId: "booth-1",
        startsAt: at("15:00"),
        endsAt: at("17:00"),
        email: "ada@example.com",
      },
      "pending",
    );
    await expect(reserve("15:30", "16:00")).rejects.toBeInstanceOf(
      db.SlotUnavailableError,
    );
  });
});

describe("queryReservations", () => {
  it("paginates, counts, filters and searches", async () => {
    await reserve("09:00", "09:30");
    await reserve("10:00", "10:30", {
      email: "bob@example.com",
      fullName: "Bob",
    });
    await db.createReservation(
      {
        boothId: "booth-2",
        startsAt: at("11:00"),
        endsAt: at("13:30"),
        email: "ada@example.com",
      },
      "pending",
    );

    const all = await db.queryReservations();
    expect(all.total).toBe(3);
    expect(all.counts).toMatchObject({ total: 3, confirmed: 2, pending: 1 });

    const pendingOnly = await db.queryReservations({ filter: "pending" });
    expect(pendingOnly.total).toBe(1);

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

describe("discardReservation", () => {
  it("removes the row outright and frees the slot", async () => {
    const db = await loadDb();
    const r = await db.createReservation({
      boothId: "booth-1",
      startsAt: "2026-07-16T14:00",
      endsAt: "2026-07-16T15:00",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(await db.discardReservation(r.id)).toBe(true);
    expect((await db.queryReservations({ filter: "all" })).total).toBe(0);

    // The whole point: the same slot books again, which a soft delete would block.
    await expect(
      db.createReservation({
        boothId: "booth-1",
        startsAt: "2026-07-16T14:00",
        endsAt: "2026-07-16T15:00",
        fullName: "Grace Hopper",
        email: "grace@example.com",
      }),
    ).resolves.toBeTruthy();
  });

  it("returns false for an id that is not there", async () => {
    const db = await loadDb();
    expect(await db.discardReservation("nope")).toBe(false);
  });
});

describe("heldRangesForEmail", () => {
  it("returns that person's active ranges for the day, in order", async () => {
    await reserve("14:00", "15:00");
    await reserve("09:00", "10:00", { boothId: "booth-2" });
    const held = await db.heldRangesForEmail("ada@example.com", D);
    expect(held).toEqual([
      { startsAt: at("09:00"), endsAt: at("10:00") },
      { startsAt: at("14:00"), endsAt: at("15:00") },
    ]);
  });

  it("spans booths, since a run is a run whichever booth each part is on", async () => {
    await reserve("14:00", "15:00");
    await reserve("15:00", "16:00", { boothId: "booth-3" });
    expect(await db.heldRangesForEmail("ada@example.com", D)).toHaveLength(2);
  });

  it("matches the email whatever its case", async () => {
    await reserve("14:00", "15:00", { email: "Ada@Example.COM" });
    expect(await db.heldRangesForEmail("ada@example.com", D)).toHaveLength(1);
  });

  it("leaves out other people", async () => {
    await reserve("14:00", "15:00", { email: "grace@example.com" });
    expect(await db.heldRangesForEmail("ada@example.com", D)).toEqual([]);
  });

  it("leaves out other days", async () => {
    await reserve("14:00", "15:00", {
      startsAt: "2026-07-17T14:00",
      endsAt: "2026-07-17T15:00",
    });
    expect(await db.heldRangesForEmail("ada@example.com", D)).toEqual([]);
  });

  it("leaves out cancelled ones, which hold nothing", async () => {
    const r = await reserve("14:00", "15:00");
    await db.updateReservationStatus(r.id, "cancelled");
    expect(await db.heldRangesForEmail("ada@example.com", D)).toEqual([]);
  });

  it("counts pending ones, which do hold their slot", async () => {
    await reserve("14:00", "15:00", {}).then(() => undefined);
    await db.createReservation(
      {
        boothId: "booth-2",
        startsAt: at("16:00"),
        endsAt: at("17:00"),
        email: "ada@example.com",
        fullName: "Ada",
      },
      "pending",
    );
    expect(await db.heldRangesForEmail("ada@example.com", D)).toHaveLength(2);
  });
});
