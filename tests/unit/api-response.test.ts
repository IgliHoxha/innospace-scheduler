import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-response";

describe("jsonError", () => {
  it("answers with the status it was given", () => {
    for (const status of [400, 401, 403, 404, 409, 429, 502]) {
      expect(jsonError("Nope.", status).status).toBe(status);
    }
  });

  it("is a NextResponse, so the route guards can tell it from a session", () => {
    expect(jsonError("Unauthorized", 401)).toBeInstanceOf(NextResponse);
  });

  it("carries ok false and the error, and nothing else", async () => {
    const body = await jsonError("Invalid status.", 400).json();
    expect(body).toEqual({ ok: false, error: "Invalid status." });
    expect(Object.keys(body)).toEqual(["ok", "error"]);
    expect(body).not.toHaveProperty("field");
  });

  it("serialises ok before error, byte for byte", async () => {
    expect(await jsonError("Not found.", 404).text()).toBe(
      '{"ok":false,"error":"Not found."}',
    );
  });

  it("passes the message through untouched", async () => {
    const message = `Expected { ids: string[] }. "quoted" it's <b> \n ok`;
    expect((await jsonError(message, 400).json()).error).toBe(message);
    expect((await jsonError("", 400).json()).error).toBe("");
  });

  it("declares a JSON body", () => {
    expect(jsonError("Forbidden", 403).headers.get("content-type")).toContain(
      "application/json",
    );
  });

  it("carries a Retry-After header when one is given", () => {
    const res = jsonError("Too many.", 429, { "Retry-After": "42" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("sets no Retry-After header when none is given", () => {
    expect(jsonError("Too many.", 429).headers.get("Retry-After")).toBeNull();
  });

  it("adds no header of its own beyond the content type", () => {
    expect([...jsonError("Nope.", 400).headers.keys()]).toEqual([
      "content-type",
    ]);
    expect([
      ...jsonError("Nope.", 429, { "Retry-After": "7" }).headers.keys(),
    ]).toEqual(["content-type", "retry-after"]);
  });

  it("builds a fresh response on every call", () => {
    expect(jsonError("Nope.", 400)).not.toBe(jsonError("Nope.", 400));
  });
});
