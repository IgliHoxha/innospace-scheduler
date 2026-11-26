import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  IBM_Plex_Sans: () => ({ variable: "font-var" }),
}));

// A translator swaps text React later replaces; the screen then dies with "Application error".
describe("the root layout keeps page translators off", () => {
  it("marks the whole document as not to be translated", async () => {
    const { default: RootLayout } = await import("@/app/layout");
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>page</p>
      </RootLayout>,
    );
    expect(html).toMatch(/^<html[^>]* translate="no"/);
    expect(html).toMatch(/^<html[^>]* class="font-var notranslate"/);
    expect(html).toContain("<body><p>page</p></body>");
  });

  it("tells Chrome's translator the same in a meta tag", async () => {
    const { metadata } = await import("@/app/layout");
    expect(metadata.other).toEqual({ google: "notranslate" });
  });
});
