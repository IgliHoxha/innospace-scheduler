import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// No DOM here, so this pins the markup the form rests on, not the rendering.
const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), "src", "app", ...parts), "utf8");
const tsx = read("ReservationClient.tsx");
const css = read("globals.css");

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

  // One shared live line re-announced the other field's reason on every edit.
  it("ties each field to its own hidden reason, read when it takes focus", () => {
    for (const id of ["fullName", "email"]) {
      expect(input(id)).toMatch(
        new RegExp(
          `aria-describedby=\\{\\s*fieldError\\("${id}"\\) \\? "${id}-error" : undefined\\s*\\}`,
        ),
      );
      expect(tsx).toMatch(
        new RegExp(
          `<span id="${id}-error" className="sr-only">\\s*\\{fieldError\\("${id}"\\)\\}\\s*</span>`,
        ),
      );
    }
    expect(tsx).not.toMatch(/role="alert"/);
  });

  // The reason must be in the page before focus moves, or nothing is read.
  it("renders the marks before it moves focus to the failing field", () => {
    expect(tsx).toMatch(
      /flushSync\(\(\) => setGuestErrors\(guestProblems\(\{ fullName, email \}\)\)\);\s*document\.getElementById\(guest\.field\)\?\.focus\(\);/,
    );
    expect(tsx).toMatch(
      /flushSync\(\(\) => setGuestErrors\(\{ \[field\]: message \}\)\);/,
    );
  });

  // With no message to read, marking one field at a time hides the second.
  it("marks every failing field on a refused press, not only the first", () => {
    expect(tsx).toMatch(
      /setGuestErrors\(guestProblems\(\{ fullName, email \}\)\)/,
    );
  });
});

describe("a reply that lands after the form moved on", () => {
  const refused = tsx.slice(
    tsx.indexOf(
      'const message = json.error || "Could not reserve that time.";',
    ),
    tsx.indexOf("reload.current({ fresh: true, keepPick: true });"),
  );

  it("names what failed in one banner instead of marking what is on screen", () => {
    expect(refused).toMatch(
      /if \(liveAttempt\.current !== attempt\) \{[\s\S]*?setError\(`\$\{when\} was not reserved\. \$\{message\}`\);\s*\} else \{/,
    );
  });

  it("marks fields and moves focus only for the attempt still on screen", () => {
    const [moved, here] = refused.split("} else {");
    expect(moved).not.toMatch(/setGuestErrors|\.focus\(\)/);
    expect(here).toMatch(/setGuestErrors\(\{ \[field\]: message \}\)/);
    expect(here).toMatch(
      /if \(field\) document\.getElementById\(field\)\?\.focus\(\);/,
    );
  });

  // Keyed to the attempt, so recording them cannot touch another pick.
  it("still records a note demand or a pick refusal against its own attempt", () => {
    expect(refused).toMatch(
      /if \(needsNote\) setNoteDemands\(\(d\) => withVerdict\(d, attempt, message\)\);\s*else if \(onPick\) setRefused\(\(r\) => withVerdict\(r, attempt, message\)\);/,
    );
  });
});

describe("switching booth or day", () => {
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

  // Left in place, the old board's pick kept its error and Reserve stayed live.
  it("drops the pick at once, so Reserve waits for the new board", () => {
    expect(reset).toMatch(/setStart\(""\);\s*setEnd\(""\);/);
    expect(tsx).not.toMatch(/resetDue/);
  });

  // What was typed is the person's, not the board's, so a switch keeps it.
  it("leaves the name, the email and the note as typed", () => {
    expect(reset).not.toMatch(/setFullName|setEmail|setNote\(/);
  });
});
