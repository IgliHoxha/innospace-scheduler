import { describe, expect, it } from "vitest";
import * as t from "@/lib/date-format";

describe("date + time formatting", () => {
  it("formatDMYShort", () => {
    expect(t.formatDMYShort("2026-07-14")).toBe("14/07/26");
    expect(t.formatDMYShort(undefined)).toBe("-");
  });

  it("formatDateLong", () => {
    expect(t.formatDateLong("2026-07-14")).toMatch(/^[A-Za-z]+, 14 July 2026$/);
    expect(t.formatDateLong(undefined)).toBe("your requested date");
  });

  it("formatDateMedium", () => {
    expect(t.formatDateMedium("2026-07-14")).toMatch(/^[A-Za-z]{3}, 14 Jul$/);
    expect(t.formatDateMedium(undefined)).toBe("");
  });

  it("formatDateTime renders a local DD/MM/YY HH:MM, or empty for junk", () => {
    expect(t.formatDateTime("2026-07-14T14:30:00")).toBe("14/07/26 14:30");
    expect(t.formatDateTime("not-a-date")).toBe("");
  });
});
