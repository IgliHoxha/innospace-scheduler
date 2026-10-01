import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// No layout engine here, so this pins the declarations the behaviour rests on, not the rendering.
const css = readFileSync(
  join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

/** The declarations of the one rule whose selector list is exactly this. */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("timeline block labels: whole or absent, never cut", () => {
  it("wraps a label too wide for its block onto a second line", () => {
    expect(rule(".daycal-block")).toMatch(/flex-wrap:\s*wrap;/);
    expect(rule(".daycal-block")).toMatch(/align-content:\s*flex-start;/);
  });

  it("makes line one the whole block with a full-height strut", () => {
    const strut = rule(".daycal-block::before");
    expect(strut).toMatch(/content:\s*"";/);
    expect(strut).toMatch(/height:\s*100%;/);
    expect(strut).toMatch(/width:\s*0;/);
  });

  // Hidden first as the fallback, then clip, which cannot be scrolled into view.
  it("clips the second line, and by clip where the engine has it", () => {
    const block = rule(".daycal-block");
    expect(block).toMatch(/overflow:\s*hidden;[\s\S]*overflow:\s*clip;/);
  });

  it("never shrinks or cuts the label itself", () => {
    const label = rule(".daycal-block-label");
    expect(label).toMatch(/flex:\s*none;/);
    expect(label).toMatch(/white-space:\s*nowrap;/);
    expect(label).not.toMatch(/text-overflow/);
  });

  // A pixel threshold is right for one font size only, which is how the stub came back.
  it("decides by fit, with no width threshold on the block", () => {
    expect(css).not.toMatch(/@container/);
    expect(rule(".daycal-block")).not.toMatch(/container-type/);
  });

  it("gives the bin no text gutter, so it fits any block as wide as itself", () => {
    expect(rule(".daycal-block .daycal-block-label.on-hover")).toMatch(
      /padding:\s*0;/,
    );
  });
});
