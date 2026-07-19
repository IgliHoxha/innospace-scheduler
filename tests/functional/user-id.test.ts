import { beforeEach, describe, expect, it } from "vitest";
import {
  adminToken,
  makeRequest,
  params,
  resetApp,
  userToken,
} from "../helpers/app";

type Route = typeof import("@/app/api/users/[id]/route");
type Db = typeof import("@/lib/db");
let route: Route;
let db: Db;

beforeEach(async () => {
  resetApp();
  db = await import("@/lib/db");
  route = await import("@/app/api/users/[id]/route");
});

const del = (id: string, tok?: string) =>
  route.DELETE(
    makeRequest(`/api/users/${id}`, { method: "DELETE", token: tok }),
    params({ id }),
  );

describe("DELETE /api/users/[id] (admin only)", () => {
  it("401 for a non-admin session", async () => {
    const u = await db.inviteUser("a@example.com");
    expect((await del(u.id, userToken("u1"))).status).toBe(401);
  });

  it("404 for an unknown member", async () => {
    expect((await del("ghost", adminToken())).status).toBe(404);
  });

  it("200 removes the member (reservations are kept)", async () => {
    const u = await db.inviteUser("a@example.com");
    const res = await del(u.id, adminToken());
    expect(res.status).toBe(200);
    expect(await db.getUserById(u.id)).toBeNull();
  });
});
