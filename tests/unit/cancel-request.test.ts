import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelByToken } from "@/lib/cancel-request";

const reply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });

const answerWith = (res: Response | Error) => {
  const fetchMock = vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cancelByToken", () => {
  it("posts the token as JSON to the emailed link's endpoint", async () => {
    const fetchMock = answerWith(reply(200, { ok: true }));
    await cancelByToken("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "tok-1" }),
    });
  });

  it("reports nothing when the server cancelled it", async () => {
    answerWith(reply(200, { ok: true }));
    expect(await cancelByToken("tok-1")).toBe("");
  });

  // So the board "/" loads next skips the edge's copy that still holds it.
  it("records that this browser changed a booking, on success only", async () => {
    answerWith(reply(410, { ok: false, error: "That link has expired." }));
    await cancelByToken("tok-1");
    expect(stored.has("innospace.wroteAt")).toBe(false);
    answerWith(reply(200, { ok: true }));
    await cancelByToken("tok-1");
    expect(Number(stored.get("innospace.wroteAt"))).toBeGreaterThan(0);
  });

  it("passes on the reason the server gave", async () => {
    answerWith(reply(410, { ok: false, error: "That link has expired." }));
    expect(await cancelByToken("tok-1")).toBe("That link has expired.");
  });

  it("falls back to its own wording when the refusal names no reason", async () => {
    answerWith(reply(400, { ok: false }));
    expect(await cancelByToken("tok-1")).toBe(
      "Could not cancel that reservation.",
    );
  });

  // A 200 must still say ok, or a proxy's page would read as a cancellation.
  it("does not trust a success status whose body is not ok", async () => {
    answerWith(reply(200, {}));
    expect(await cancelByToken("tok-1")).toBe(
      "Could not cancel that reservation.",
    );
  });

  it("does not trust an ok body on a failing status", async () => {
    answerWith(reply(500, { ok: true }));
    expect(await cancelByToken("tok-1")).toBe(
      "Could not cancel that reservation.",
    );
  });

  it("survives a body that is not JSON", async () => {
    answerWith(reply(502, "<html>Bad gateway</html>"));
    expect(await cancelByToken("tok-1")).toBe(
      "Could not cancel that reservation.",
    );
  });

  it("says the server was unreachable when the request never lands", async () => {
    answerWith(new TypeError("Failed to fetch"));
    expect(await cancelByToken("tok-1")).toBe(
      "Could not reach the server. Please try again.",
    );
  });
});
