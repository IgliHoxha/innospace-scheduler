import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins classes and lets the later Tailwind utility win", () => {
    expect(cn("px-2", "text-sm")).toBe("px-2 text-sm");
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("drops falsy entries, so a conditional class can be inlined", () => {
    expect(cn("btn", false && "hidden", undefined, null, "on")).toBe("btn on");
  });
});
