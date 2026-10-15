// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserMenu } from "@/components/UserMenu";

let sent: { url: string; init?: RequestInit }[];
let replaced: string[];

beforeEach(() => {
  sent = [];
  replaced = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }),
  );
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, replace: (to: string) => replaced.push(to) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /Ada/ }));
  return screen.getByRole("menu");
};

describe("the user menu", () => {
  it("shows the initial and the name, and opens on a click", async () => {
    const user = userEvent.setup();
    render(<UserMenu username="Ada Lovelace" />);
    const btn = screen.getByRole("button", { name: /Ada/ });
    expect(btn.querySelector(".avatar")?.textContent).toBe("A");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    const menu = await open(user);
    expect(menu.textContent).toContain("Signed in asAda Lovelace");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a member's address under the name, and nothing for the admin", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <UserMenu username="Ada Lovelace" email="ada@example.com" />,
    );
    expect((await open(user)).querySelector(".user-email")?.textContent).toBe(
      "ada@example.com",
    );
    unmount();
    render(<UserMenu username="Ada Admin" />);
    expect((await open(user)).querySelector(".user-email")).toBeNull();
  });

  it("signs out through the login route and lands on the admin login by default", async () => {
    const user = userEvent.setup();
    render(<UserMenu username="Ada Admin" />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(replaced).toEqual(["/login"]));
    expect(sent).toEqual([{ url: "/api/login", init: { method: "DELETE" } }]);
  });

  // A booker is sent back to book as a guest, never to the admin's login.
  it("lands wherever it is told instead, for a member", async () => {
    const user = userEvent.setup();
    render(
      <UserMenu
        username="Ada Lovelace"
        email="ada@example.com"
        signOutTo="/"
      />,
    );
    await open(user);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(replaced).toEqual(["/"]));
  });

  it("closes on Escape and on a click elsewhere", async () => {
    const user = userEvent.setup();
    render(<UserMenu username="Ada Lovelace" />);
    await open(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await open(user);
    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
