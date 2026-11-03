import { describe, expect, it } from "vitest";
import { foldForSearch } from "@/lib/search";

describe("foldForSearch", () => {
  it("lowercases the Albanian capitals SQLite leaves alone", () => {
    expect(foldForSearch("ÇELIK")).toBe("celik");
    expect(foldForSearch("Ëndrit")).toBe("endrit");
  });

  it("drops accents, so a plain keyboard still finds the name", () => {
    expect(foldForSearch("çë")).toBe("ce");
    expect(foldForSearch("José Müller")).toBe("jose muller");
  });

  it("leaves wildcard characters as plain text", () => {
    expect(foldForSearch("50%_off")).toBe("50%_off");
  });

  it("returns empty for empty", () => {
    expect(foldForSearch("")).toBe("");
  });
});
