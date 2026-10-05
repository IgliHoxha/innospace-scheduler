import { describe, expect, it } from "vitest";
import { jsonBody } from "@/lib/api-request";

const request = (body?: string) =>
  new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

describe("jsonBody", () => {
  it("hands back an object body as it was sent", async () => {
    expect(await jsonBody(request('{"a":1,"b":{"c":[2,3]},"d":null}'))).toEqual(
      { a: 1, b: { c: [2, 3] }, d: null },
    );
  });

  it("reads an empty object as empty", async () => {
    expect(await jsonBody(request("{}"))).toEqual({});
  });

  it("reads a missing or unparseable body as empty", async () => {
    expect(await jsonBody(request())).toEqual({});
    expect(await jsonBody(request(""))).toEqual({});
    expect(await jsonBody(request("{ not json"))).toEqual({});
  });

  // null parses fine, and reading a member of it is what used to throw.
  it("reads a literal null as empty", async () => {
    expect(await jsonBody(request("null"))).toEqual({});
  });

  it("reads a list as empty, so its indexes are never taken for fields", async () => {
    expect(await jsonBody(request('[{"login":"admin"}]'))).toEqual({});
    expect(await jsonBody(request("[]"))).toEqual({});
  });

  it("reads a scalar as empty", async () => {
    for (const scalar of ["5", '"text"', "true", "false", "0"]) {
      expect(await jsonBody(request(scalar))).toEqual({});
    }
  });

  it("returns a fresh object each time nothing usable was sent", async () => {
    const first = await jsonBody(request("null"));
    first.leaked = true;
    expect(await jsonBody(request("null"))).toEqual({});
  });
});
