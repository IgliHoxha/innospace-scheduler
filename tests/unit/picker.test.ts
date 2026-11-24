import { describe, expect, it } from "vitest";
import { searchOptions } from "@/lib/picker";

const weeks = [
  { value: "1", label: "Just this once" },
  { value: "2", label: "Every week for 2 weeks" },
  { value: "3", label: "Every week for 3 weeks" },
];
const labels = (query: string) =>
  searchOptions(weeks, query).map((o) => o.label);

describe("searchOptions", () => {
  it("returns every option, in order, for a blank query", () => {
    expect(labels("")).toEqual(weeks.map((w) => w.label));
    expect(labels("   ")).toEqual(weeks.map((w) => w.label));
  });

  it("hands back a copy, so a caller cannot reorder the list it passed", () => {
    expect(searchOptions(weeks, "")).not.toBe(weeks);
  });

  it("matches without regard to case", () => {
    expect(labels("ONCE")).toEqual(["Just this once"]);
  });

  it("needs every term to match", () => {
    expect(labels("every 3")).toEqual(["Every week for 3 weeks"]);
    expect(labels("every once")).toEqual([]);
  });

  it("ranks a label starting with the term above one that only contains it", () => {
    const options = [
      { value: "a", label: "Weekly" },
      { value: "b", label: "Every week" },
      { value: "c", label: "Biweekly" },
    ];
    expect(searchOptions(options, "week").map((o) => o.value)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("finds nothing for a term no label holds", () => {
    expect(labels("month")).toEqual([]);
  });
});
