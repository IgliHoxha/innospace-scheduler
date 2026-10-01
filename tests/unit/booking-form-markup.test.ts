import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// No DOM here, so this pins the markup the form's behaviour rests on, not the rendering.
const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), "src", "app", ...parts), "utf8");
const tsx = read("ReservationClient.tsx");
const css = read("globals.css");

/** The opening tag of the input with this id, attributes and all. */
function input(id: string): string {
  const at = tsx.indexOf(`id="${id}"`);
  expect(at, `no input ${id}`).toBeGreaterThan(-1);
  return tsx.slice(tsx.lastIndexOf("<input", at), tsx.indexOf("/>", at));
}

describe("who's booking: name and email", () => {
  it("marks both labels as required with a star kept from screen readers", () => {
    expect(tsx).toMatch(/Full name <b aria-hidden="true">\*<\/b>/);
    expect(tsx).toMatch(/Email <b aria-hidden="true">\*<\/b>/);
    expect(css).toMatch(/\.guest-field b \{\s*color: #dc2626;/);
  });

  it("tells assistive technology the same through the inputs themselves", () => {
    for (const id of ["fullName", "email"]) {
      expect(input(id)).toMatch(/\brequired\b/);
      expect(input(id)).toMatch(
        new RegExp(`aria-invalid=\\{!!fieldError\\("${id}"\\)\\}`),
      );
      expect(input(id)).toMatch(
        new RegExp(
          `className=\\{fieldError\\("${id}"\\) \\? "invalid" : ""\\}`,
        ),
      );
    }
  });

  it("paints an invalid field red", () => {
    expect(css).toMatch(
      /\.guest-field input\.invalid \{\s*border-color: #dc2626;\s*background: #fef2f2;/,
    );
  });

  // The red field is the whole visible cue: no alert box under the two inputs.
  it("shows no visible message for a name or email problem", () => {
    expect(tsx).not.toMatch(/guestError\b/);
    expect(tsx).not.toMatch(/<p className="error">\{(guest|fieldError)/);
    expect(css).not.toMatch(/\.guest-card \.error/);
  });

  it("keeps the reason for screen readers in a hidden live line", () => {
    expect(tsx).toMatch(
      /<p className="sr-only" role="alert">\s*\{\[fieldError\("fullName"\), fieldError\("email"\)\]/,
    );
  });

  // With no message to read, marking one field at a time would hide the second problem.
  it("marks every failing field on a refused press, not only the first", () => {
    expect(tsx).toMatch(
      /setGuestErrors\(guestProblems\(\{ fullName, email \}\)\)/,
    );
  });
});

describe("switching booth or day", () => {
  /** The body of the effect that runs when the booth or the date changes. */
  const reset = (() => {
    const end = tsx.indexOf("}, [boothId, date]);");
    expect(end).toBeGreaterThan(-1);
    return tsx.slice(tsx.lastIndexOf("useEffect(() => {", end), end);
  })();

  it("clears every error the form was showing", () => {
    expect(reset).toMatch(/setError\(""\);/);
    expect(reset).toMatch(/setGuestErrors\(\{\}\);/);
    expect(reset).toMatch(/setRefused\(NO_VERDICTS\);/);
    expect(reset).toMatch(/setNoteDemands\(NO_VERDICTS\);/);
    expect(reset).toMatch(/setAskedFor\(null\);/);
  });

  it("clears the confirmation banner too, which spoke about the other board", () => {
    expect(reset).toMatch(/setSuccess\(null\);/);
  });

  // What was typed is the person's, not the board's, so a switch must not wipe it.
  it("leaves the name, the email and the note as typed", () => {
    expect(reset).not.toMatch(/setFullName|setEmail|setNote\(/);
  });
});
