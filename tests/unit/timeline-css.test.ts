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
  // Comments out, so a word in one cannot pass for a declaration.
  return css.slice(at, css.indexOf("}", at)).replace(/\/\*.*?\*\//g, "");
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

  // A fixed height cut a label whose line outgrew it; a floor lets the bar follow its text.
  it("gives the bar a floor rather than a fixed height", () => {
    const bar = rule(".daycal-bar");
    expect(bar).toMatch(/min-height:\s*46px;/);
    expect(bar).not.toMatch(/(?<!min-)height:/);
  });

  it("sizes the bar with an unseen, zero-width line in the label's own class", () => {
    const sizer = rule(".daycal-block-label.daycal-sizer");
    expect(sizer).toMatch(/display:\s*block;/);
    expect(sizer).toMatch(/width:\s*0;/);
    expect(sizer).toMatch(/padding:\s*0;/);
    expect(sizer).toMatch(/visibility:\s*hidden;/);
    expect(sizer).not.toMatch(/position|font-size|line-height|height/);
  });

  // The class is what makes any enlargement of the labels reach the bar too.
  it("renders that sizer inside the bar, hidden from assistive technology", () => {
    const tsx = readFileSync(
      join(process.cwd(), "src", "app", "DayTimeline.tsx"),
      "utf8",
    );
    expect(tsx).toMatch(
      /ref=\{barRef\}\s*>\s*\{\/\*.*\*\/\}\s*<span className="daycal-block-label daycal-sizer" aria-hidden="true">/,
    );
  });

  it("gives the bin no text gutter, so it fits any block as wide as itself", () => {
    expect(rule(".daycal-block .daycal-block-label.on-hover")).toMatch(
      /padding:\s*0;/,
    );
  });
});

describe("timeline text enlarged: nothing overflows its strip", () => {
  const tsx = readFileSync(
    join(process.cwd(), "src", "app", "DayTimeline.tsx"),
    "utf8",
  );

  // Two sizers stacked would add their heights; in a row the taller one wins.
  it("lays the bar's sizers side by side", () => {
    expect(rule(".daycal-bar")).toMatch(/display:\s*flex;/);
  });

  it("gives the hour marks a floor rather than a fixed height", () => {
    const strip = rule(".daycal-ticks");
    expect(strip).toMatch(/min-height:\s*15px;/);
    expect(strip).not.toMatch(/(?<!min-)height:/);
  });

  // Without it an in-flow sibling pushes every mark's resting place down a line.
  it("pins each hour mark to the top of its strip", () => {
    const tick = rule(".daycal-tick");
    expect(tick).toMatch(/position:\s*absolute;/);
    expect(tick).toMatch(/top:\s*0;/);
  });

  it("keeps one unseen mark in flow, as wide as its text", () => {
    const sizer = rule(".daycal-tick.daycal-sizer");
    expect(sizer).toMatch(/position:\s*static;/);
    expect(sizer).toMatch(/display:\s*block;/);
    expect(sizer).toMatch(/width:\s*max-content;/);
    expect(sizer).toMatch(/visibility:\s*hidden;/);
    expect(sizer).not.toMatch(/font-size|line-height/);
  });

  it("measures that mark and thins the labels by its real width", () => {
    expect(tsx).toMatch(
      /ref=\{tickRef\}\s*className="daycal-tick daycal-sizer"\s*aria-hidden="true"\s*>\s*00:00\s*<\/span>/,
    );
    expect(tsx).toMatch(/setTickPx\(tick\.offsetWidth\)/);
    expect(tsx).toMatch(
      /fittingTicks\(\s*dayStartMin,\s*dayEndMin,\s*barPx,\s*tickPx,/,
    );
  });

  it("keeps an unseen line of the tag in flow, zero wide inside the bar", () => {
    const sizer = rule(".daycal-pick-tag.daycal-sizer");
    expect(sizer).toMatch(/position:\s*static;/);
    expect(sizer).toMatch(/display:\s*block;/);
    expect(sizer).toMatch(/width:\s*0;/);
    expect(sizer).toMatch(/visibility:\s*hidden;/);
    expect(tsx).toMatch(
      /<span className="daycal-pick-tag daycal-sizer" aria-hidden="true">/,
    );
  });

  // Padding on the plot was right for one text size; a line of the tag itself is right for all.
  it("makes the strip above the bar out of the floating tag's own line", () => {
    const strip = rule(".daycal-pick-tag.above.daycal-sizer");
    expect(strip).toMatch(/min-height:\s*20px;/);
    expect(strip).toMatch(/padding-bottom:\s*5px;/);
    expect(strip).toMatch(/width:\s*auto;/);
    expect(css).not.toMatch(/has-toptag/);
    expect(tsx).not.toMatch(/has-toptag/);
    expect(tsx).toMatch(
      /\{tag\?\.above && \(\s*<span\s*className="daycal-pick-tag above daycal-sizer"\s*aria-hidden="true"\s*>/,
    );
  });

  it("decides inside or above by the tag's measured text, not a fixed width alone", () => {
    expect(tsx).toMatch(
      /fitsPx:\s*roomFor\(tagTextPx,\s*TAG_FITS_PX,\s*1,\s*TAG_MARGIN_PX\)/,
    );
  });
});
