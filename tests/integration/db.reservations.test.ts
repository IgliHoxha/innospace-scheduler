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

    const ranges = db.reservedRanges("booth-1", D);
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
    expect(db.reservedRanges("booth-1", D)).toHaveLength(1);
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

  it("sees through Gmail dots and tags: one inbox can't hold two booths at once", async () => {
    await reserve("10:00", "11:00", { email: "igli.ihoxha@gmail.com" });
    await expect(
      reserve("10:30", "11:30", {
        boothId: "booth-2",
        email: "igliihoxha+booth@gmail.com",
      }),
    ).rejects.toBeInstanceOf(db.UserBusyError);
  });

  it("does not let a row with no email block anyone", async () => {
    await reserve("10:00", "11:00", { email: undefined });
    await expect(
      reserve("10:30", "11:30", { boothId: "booth-2" }),
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
    db.updateReservationStatus(r.id, "cancelled");
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
    db.createReservation(
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
    db.createReservation(
      {
        boothId: "booth-2",
        startsAt: at("11:00"),
        endsAt: at("13:30"),
        email: "ada@example.com",
      },
      "pending",
    );

    const all = db.queryReservations();
    expect(all.total).toBe(3);
    expect(all.counts).toMatchObject({ total: 3, confirmed: 2, pending: 1 });

    const pendingOnly = db.queryReservations({ filter: "pending" });
    expect(pendingOnly.total).toBe(1);

    const searchBob = db.queryReservations({ search: "bob" });
    expect(searchBob.total).toBe(1);

    const firstPage = db.queryReservations({ pageSize: 2, page: 1 });
    expect(firstPage.reservations).toHaveLength(2);
    expect(firstPage.pageSize).toBe(2);
  });

  it("hides soft-deleted rows from the default view", async () => {
    const r = await reserve("10:00", "11:00");
    db.updateReservationStatus(r.id, "deleted");
    expect(db.queryReservations().total).toBe(0);
    expect(db.queryReservations({ filter: "deleted" }).total).toBe(1);
  });
});

describe("status update + delete guard", () => {
  it("updates status and returns the row, or null for a missing id", async () => {
    const r = await reserve("10:00", "11:00");
    const updated = db.updateReservationStatus(r.id, "cancelled");
    expect(updated?.status).toBe("cancelled");
    expect(db.updateReservationStatus("nope", "cancelled")).toBeNull();
  });

  it("hard-deletes only soft-deleted rows", async () => {
    const live = await reserve("10:00", "11:00");
    expect(db.deleteReservations([live.id])).toBe(0); // not deleted yet

    db.updateReservationStatus(live.id, "deleted");
    expect(db.deleteReservations([live.id])).toBe(1);
    expect(db.getReservation(live.id)).toBeNull();
    expect(db.deleteReservations([])).toBe(0);
  });
});

describe("discardReservation", () => {
  it("removes the row outright and frees the slot", async () => {
    const db = await loadDb();
    const r = db.createReservation({
      boothId: "booth-1",
      startsAt: "2026-07-16T14:00",
      endsAt: "2026-07-16T15:00",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(db.discardReservation(r.id)).toBe(true);
    expect(db.queryReservations({ filter: "all" }).total).toBe(0);

    // The whole point: the same slot books again, which a soft delete would block.
    expect(
      db.createReservation({
        boothId: "booth-1",
        startsAt: "2026-07-16T14:00",
        endsAt: "2026-07-16T15:00",
        fullName: "Grace Hopper",
        email: "grace@example.com",
      }),
    ).toBeTruthy();
  });

  it("returns false for an id that is not there", async () => {
    const db = await loadDb();
    expect(db.discardReservation("nope")).toBe(false);
  });
});

// The board is what the browser checks its remembered bookings against, so a dead row must leave it.
describe("reservedRanges", () => {
  it("drops a cancelled booking, freeing the slot it held", async () => {
    const r = await reserve("10:00", "11:00");
    expect(db.reservedRanges("booth-1", D)).toHaveLength(1);
    db.updateReservationStatus(r.id, "cancelled");
    expect(db.reservedRanges("booth-1", D)).toEqual([]);
  });

  it("drops a deleted booking too", async () => {
    const r = await reserve("10:00", "11:00");
    db.updateReservationStatus(r.id, "deleted");
    expect(db.reservedRanges("booth-1", D)).toEqual([]);
  });

  // A pending request holds its slot, so the board has to show it as taken like any other.
  it("keeps a pending booking, which is holding its slot", async () => {
    await reserve("10:00", "11:00");
    db.createReservation(
      { boothId: "booth-1", startsAt: at("14:00"), endsAt: at("15:00") },
      "pending",
    );
    expect(db.reservedRanges("booth-1", D)).toEqual([
      { startsAt: at("10:00"), endsAt: at("11:00") },
      { startsAt: at("14:00"), endsAt: at("15:00") },
    ]);
  });

  it("shows one booth only, so another booth's booking cannot mark this board", async () => {
    await reserve("10:00", "11:00", { boothId: "booth-2" });
    expect(db.reservedRanges("booth-1", D)).toEqual([]);
    expect(db.reservedRanges("booth-2", D)).toHaveLength(1);
  });

  it("shows one day only", async () => {
    await reserve("10:00", "11:00", {
      startsAt: "2026-07-17T10:00",
      endsAt: "2026-07-17T11:00",
    });
    expect(db.reservedRanges("booth-1", D)).toEqual([]);
  });

  // The browser matches an entry by its start time, so out-of-order rows would mislabel the board.
  it("returns them in time order", async () => {
    await reserve("14:00", "15:00");
    await reserve("09:00", "10:00");
    expect(db.reservedRanges("booth-1", D).map((r) => r.startsAt)).toEqual([
      at("09:00"),
      at("14:00"),
    ]);
  });
});

describe("heldRangesForEmail", () => {
  it("returns that person's active ranges for the day, in order", async () => {
    await reserve("14:00", "15:00");
    await reserve("09:00", "10:00", { boothId: "booth-2" });
    const held = db.heldRangesForEmail("ada@example.com", D);
    expect(held).toEqual([
      { startsAt: at("09:00"), endsAt: at("10:00") },
      { startsAt: at("14:00"), endsAt: at("15:00") },
    ]);
  });

  it("spans booths, since a run is a run whichever booth each part is on", async () => {
    await reserve("14:00", "15:00");
    await reserve("15:00", "16:00", { boothId: "booth-3" });
    expect(db.heldRangesForEmail("ada@example.com", D)).toHaveLength(2);
  });

  it("matches the email whatever its case", async () => {
    await reserve("14:00", "15:00", { email: "Ada@Example.COM" });
    expect(db.heldRangesForEmail("ada@example.com", D)).toHaveLength(1);
  });

  it("leaves out other people", async () => {
    await reserve("14:00", "15:00", { email: "grace@example.com" });
    expect(db.heldRangesForEmail("ada@example.com", D)).toEqual([]);
  });

  it("matches Gmail past its dots and plus tags, since it is one inbox", async () => {
    await reserve("14:00", "15:00", { email: "igli.ihoxha@gmail.com" });
    await reserve("15:00", "16:00", {
      boothId: "booth-2",
      email: "igliihoxha+booth@googlemail.com",
    });
    expect(db.heldRangesForEmail("igliihoxha@gmail.com", D)).toHaveLength(2);
  });

  it("ignores a row with no email rather than matching or throwing", async () => {
    await reserve("14:00", "15:00", { email: undefined });
    await reserve("15:00", "16:00", { boothId: "booth-2" });
    const held = db.heldRangesForEmail("ada@example.com", D);
    expect(held).toEqual([{ startsAt: at("15:00"), endsAt: at("16:00") }]);
  });

  it("leaves out other days", async () => {
    await reserve("14:00", "15:00", {
      startsAt: "2026-07-17T14:00",
      endsAt: "2026-07-17T15:00",
    });
    expect(db.heldRangesForEmail("ada@example.com", D)).toEqual([]);
  });

  it("leaves out cancelled ones, which hold nothing", async () => {
    const r = await reserve("14:00", "15:00");
    db.updateReservationStatus(r.id, "cancelled");
    expect(db.heldRangesForEmail("ada@example.com", D)).toEqual([]);
  });

  it("counts pending ones, which do hold their slot", async () => {
    await reserve("14:00", "15:00", {}).then(() => undefined);
    db.createReservation(
      {
        boothId: "booth-2",
        startsAt: at("16:00"),
        endsAt: at("17:00"),
        email: "ada@example.com",
        fullName: "Ada",
      },
      "pending",
    );
    expect(db.heldRangesForEmail("ada@example.com", D)).toHaveLength(2);
  });
});

describe("rows stored with fields left unset", () => {
  it("keeps an absent name, email and note as null rather than the string 'undefined'", async () => {
    const r = db.createReservation({
      boothId: "booth-1",
      startsAt: at("14:00"),
      endsAt: at("15:00"),
    });
    const back = db.getReservation(r.id);
    expect(back).toMatchObject({ boothId: "booth-1", status: "confirmed" });
    expect(back?.fullName).toBeUndefined();
    expect(back?.email).toBeUndefined();
    expect(back?.note).toBeUndefined();
    // It still lists and searches without throwing on the missing columns.
    const page = db.queryReservations({ search: "booth-1" });
    expect(page.total).toBe(1);
  });
});
