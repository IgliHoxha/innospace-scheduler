import { describe, expect, it } from "vitest";
import { cn, pad2 } from "@/lib/utils";

describe("pad2", () => {
  it("zero-pads a single digit to two", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(9)).toBe("09");
  });

  it("leaves two-or-more digit numbers unchanged", () => {
    expect(pad2(10)).toBe("10");
    expect(pad2(59)).toBe("59");
    expect(pad2(123)).toBe("123");
  });
});

describe("cn", () => {
  it("joins classes and lets the later Tailwind utility win", () => {
    expect(cn("px-2", "text-sm")).toBe("px-2 text-sm");
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("drops falsy entries, so a conditional class can be inlined", () => {
    expect(cn("btn", false && "hidden", undefined, null, "on")).toBe("btn on");
  });
});
