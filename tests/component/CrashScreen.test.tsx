// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageError from "@/app/error";
import GlobalError from "@/app/global-error";
import { CrashScreen } from "@/components/CrashScreen";

afterEach(cleanup);

describe("the crash screen", () => {
  it("says what happened and what to do, where a screen reader hears it", () => {
    render(<CrashScreen onReload={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong.");
    expect(alert.textContent).toContain("Reload it to carry on.");
    // A crash can land after the booking went through, so it never says "nothing was booked".
    expect(alert.textContent).toContain(
      "check your email for a confirmation before you try again",
    );
    expect(screen.getByAltText("Innospace Tirana").getAttribute("src")).toBe(
      "/logo.svg",
    );
  });

  it("reloads the page from its one button", async () => {
    const onReload = vi.fn();
    render(<CrashScreen onReload={onReload} />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("is what a crashed page shows", () => {
    render(<PageError />);
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  // It replaces the root layout, so the translation guard has to come with it.
  it("is what a crashed layout shows, in a whole document of its own", () => {
    const html = renderToStaticMarkup(<GlobalError />);
    expect(html).toMatch(
      /^<html lang="en" translate="no" class="notranslate">/,
    );
    expect(html).toContain("Something went wrong.");
    expect(html).toContain(">Reload</button>");
  });
});
