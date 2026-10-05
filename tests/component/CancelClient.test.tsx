// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CancelClient from "@/app/cancel/CancelClient";

const UNREACHABLE = "Could not reach the server. Please try again.";

type Reply = { status: number; body: unknown } | "drop" | "html";

let replies: Reply[];
let sent: { url: string; init: RequestInit }[];
let release: (() => void) | null;
let rejections: unknown[];
const onRejection = (e: PromiseRejectionEvent) => rejections.push(e.reason);

beforeEach(() => {
  replies = [];
  sent = [];
  release = null;
  rejections = [];
  window.addEventListener("unhandledrejection", onRejection);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      if (release === null) await new Promise<void>((r) => (release = r));
      const next = replies.shift() ?? { status: 200, body: { ok: true } };
      if (next === "drop") throw new TypeError("Failed to fetch");
      if (next === "html")
        return {
          ok: false,
          status: 502,
          json: async () => JSON.parse("<html>"),
        };
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => next.body,
      };
    }),
  );
});

afterEach(() => {
  window.removeEventListener("unhandledrejection", onRejection);
  cleanup();
  vi.unstubAllGlobals();
});

/** The page's client part, with every reply answered at once unless a test holds it. */
function mount({ held = false } = {}) {
  release = held ? null : () => {};
  const user = userEvent.setup();
  render(
    <CancelClient
      token="tok-1"
      booth="Booth 2"
      date="Thursday, 16 July 2026"
      time="14:00 - 15:00"
    />,
  );
  return user;
}

const confirm = () => screen.getByRole("button") as HTMLButtonElement;
const alert = () => document.querySelector("p.error")?.textContent ?? "";

describe("the cancel page", () => {
  it("says which booking is about to go and offers both ways out", () => {
    mount();
    const question = document.querySelector("p")!;
    expect(question.textContent).toBe(
      "Cancel this reservation?Booth 2Thursday, 16 July 202614:00 - 15:00",
    );
    expect(question.querySelector("strong")?.textContent).toBe("Booth 2");
    expect(confirm().textContent).toBe("Yes, cancel it");
    expect(confirm().className).toBe("btn danger");
    expect(confirm().disabled).toBe(false);
    const keep = screen.getByRole("link", { name: "Keep it" });
    expect(keep.getAttribute("href")).toBe("/");
    expect(alert()).toBe("");
    expect(sent).toEqual([]);
  });

  it("sends the link's token, once, and confirms the slot is free", async () => {
    const user = mount();
    await user.click(confirm());
    await waitFor(() =>
      expect(document.querySelector("p")?.textContent).toBe(
        "Your reservation is cancelled. The slot is free for someone else now.",
      ),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/cancel");
    expect(sent[0].init.method).toBe("POST");
    expect(sent[0].init.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(sent[0].init.body).toBe(JSON.stringify({ token: "tok-1" }));
    expect(screen.queryByRole("button")).toBeNull();
    const again = screen.getByRole("link", { name: "Book another" });
    expect(again.getAttribute("href")).toBe("/");
    expect(again.className).toBe("btn");
  });

  it("locks the button while the request is away, so it cannot go twice", async () => {
    const user = mount({ held: true });
    await user.click(confirm());
    await waitFor(() => expect(confirm().textContent).toBe("Cancelling…"));
    expect(confirm().disabled).toBe(true);
    await user.click(confirm());
    expect(sent).toHaveLength(1);
    release!();
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(sent).toHaveLength(1);
  });

  it("shows the server's reason and lets the visitor try again", async () => {
    replies.push({
      status: 400,
      body: { ok: false, error: "This cancellation link is no longer valid." },
    });
    const user = mount();
    await user.click(confirm());
    await waitFor(() =>
      expect(alert()).toBe("This cancellation link is no longer valid."),
    );
    expect(confirm().disabled).toBe(false);
    expect(confirm().textContent).toBe("Yes, cancel it");
    expect(screen.getByRole("link", { name: "Keep it" })).toBeTruthy();
  });

  it("falls back to its own sentence when a refusal carries no reason", async () => {
    replies.push({ status: 404, body: { ok: false } }, "html");
    const user = mount();
    await user.click(confirm());
    await waitFor(() =>
      expect(alert()).toBe("Could not cancel that reservation."),
    );
    await user.click(confirm());
    await waitFor(() => expect(sent).toHaveLength(2));
    await waitFor(() => expect(confirm().disabled).toBe(false));
    expect(alert()).toBe("Could not cancel that reservation.");
    expect(rejections).toEqual([]);
  });

  it("does not take a 200 that says no for a cancellation", async () => {
    replies.push({ status: 200, body: { ok: false, error: "Not this time." } });
    const user = mount();
    await user.click(confirm());
    await waitFor(() => expect(alert()).toBe("Not this time."));
    expect(screen.getByRole("button")).toBeTruthy();
  });

  // The button used to stay on "Cancelling…" for good, with nothing said.
  it("says so and frees the button when the server cannot be reached", async () => {
    replies.push("drop");
    const user = mount();
    await user.click(confirm());
    await waitFor(() => expect(alert()).toBe(UNREACHABLE));
    expect(confirm().disabled).toBe(false);
    expect(confirm().textContent).toBe("Yes, cancel it");
    expect(rejections).toEqual([]);
  });

  it("clears the old message on a retry, which can then succeed", async () => {
    replies.push("drop");
    const user = mount();
    await user.click(confirm());
    await waitFor(() => expect(alert()).toBe(UNREACHABLE));
    release = null;
    await user.click(confirm());
    await waitFor(() => expect(confirm().disabled).toBe(true));
    expect(alert()).toBe("");
    release!();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Book another" })).toBeTruthy(),
    );
    expect(sent).toHaveLength(2);
    expect(alert()).toBe("");
  });
});
