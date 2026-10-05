import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom applies no stylesheet, so the declarations the alerts' place rests on are pinned as text.
const css = readFileSync(
  join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

const layer = (rule: string) =>
  Number(css.match(new RegExp(`${rule} \\{[^}]*z-index: (\\d+);`))?.[1]);

describe("the alerts above the dashboard list", () => {
  // The row that failed can be thousands of pixels down, so the alert follows the scroll.
  it("sticks them just under the top bar", () => {
    expect(css).toMatch(
      /\.list-alerts \{\s*position: sticky;\s*top: 81px;\s*z-index: 20;/,
    );
  });

  it("stacks them under the top bar, its menu and any dialog", () => {
    expect(layer("\\.list-alerts")).toBe(20);
    expect(layer("\\.topbar")).toBeGreaterThan(20);
    expect(layer("\\.user-dropdown")).toBeGreaterThan(20);
    expect(layer("\\.modal-overlay")).toBeGreaterThan(20);
  });

  it("sets each button at the far edge, whole, on the page's white", () => {
    expect(css).toMatch(
      /\.list-alerts \.btn \{\s*margin-left: auto;\s*flex-shrink: 0;\s*background: var\(--card\);/,
    );
  });

  it("lifts each alert off the rows it floats over", () => {
    expect(css).toMatch(/\.list-alerts \.error \{\s*box-shadow: /);
  });
});
