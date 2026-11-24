import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom applies no stylesheet, so the form's CSS is pinned as text.
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

describe("the quick length buttons", () => {
  it("sit in a row lifted like the duration pill", () => {
    expect(css).toMatch(
      /\.length-presets \{\s*display: flex;\s*gap: 6px;\s*margin-bottom: 6px;/,
    );
  });

  it("fade a length that is not free", () => {
    expect(css).toMatch(
      /\.length-presets \.chip:disabled \{\s*opacity: 0\.4;\s*cursor: not-allowed;/,
    );
  });
});

describe("a board that could not be loaded", () => {
  it("sets the message and its retry button side by side", () => {
    expect(css).toMatch(
      /\.load-failed \{\s*display: flex;\s*align-items: center;\s*gap: 12px;/,
    );
  });
});

describe("the repeat dropdown", () => {
  it("floats its list over the page below the field", () => {
    expect(css).toMatch(
      /\.combo-list \{\s*position: absolute;\s*z-index: 30;\s*top: calc\(100% \+ 4px\);/,
    );
  });

  it("leaves room on the right for the chevron, which a click passes through", () => {
    expect(css).toMatch(
      /\.combo \.combo-input \{[^}]*padding: 9px 36px 9px 12px;/,
    );
    expect(css).toMatch(/\.combo-chevron \{[^}]*pointer-events: none;/);
  });

  it("lets the list spill out of its card instead of being clipped", () => {
    expect(css).toMatch(/\.card\.repeat-card \{\s*overflow: visible;/);
  });

  it("keeps no style for the native select it replaced", () => {
    expect(css).not.toMatch(/\.guest-field select/);
  });
});

describe("the my bookings dialog", () => {
  it("scrolls inside the window instead of running off it", () => {
    expect(css).toMatch(
      /\.my-bookings-modal \{[^}]*max-height: calc\(100vh - 40px\);\s*overflow-y: auto;/,
    );
  });

  it("marks the booking under way in the brand colour", () => {
    expect(css).toMatch(
      /\.my-booking\.ongoing \{\s*border-color: var\(--brand\);/,
    );
  });

  it("keeps a note's line breaks and wraps a long word", () => {
    expect(css).toMatch(
      /\.my-booking-note \{\s*white-space: pre-wrap;\s*overflow-wrap: anywhere;/,
    );
  });

  it("writes a status phrase in sentence case", () => {
    expect(css).toMatch(/\.my-booking \.badge \{\s*text-transform: none;/);
  });

  it("keeps sign out red but an ordinary menu item plain", () => {
    expect(css).toMatch(
      /\.user-dropdown-item\.plain \{\s*color: var\(--text\);/,
    );
  });
});
