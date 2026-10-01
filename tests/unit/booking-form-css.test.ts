import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom applies no stylesheet, so the declarations the form's look rests on are pinned as text.
const css = readFileSync(
  join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

describe("who's booking: name and email", () => {
  it("paints an invalid field red", () => {
    expect(css).toMatch(
      /\.guest-field input\.invalid \{\s*border-color: #dc2626;\s*background: #fef2f2;/,
    );
  });

  it("paints the required star red", () => {
    expect(css).toMatch(/\.guest-field b \{\s*color: #dc2626;/);
  });

  // The red field is the whole visible cue: no alert box under the two inputs.
  it("keeps no style for an alert inside the card", () => {
    expect(css).not.toMatch(/\.guest-card \.error/);
  });
});

describe("a board that could not be loaded", () => {
  it("sets the message and its retry button side by side", () => {
    expect(css).toMatch(
      /\.load-failed \{\s*display: flex;\s*align-items: center;\s*gap: 12px;/,
    );
  });
});
