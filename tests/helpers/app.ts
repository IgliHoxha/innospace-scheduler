// Shared test plumbing: throwaway SQLite DBs, module reset, request/session builders.
import { vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, createSessionToken, type Session } from "@/lib/auth";

const tmpFiles: string[] = [];

/** A unique temp path for a throwaway SQLite DB. */
export function freshDataFile(): string {
  const f = path.join(os.tmpdir(), `innospace-test-${randomUUID()}.db`);
  tmpFiles.push(f);
  return f;
}

/** Remove every temp DB file created so far (plus its WAL/SHM sidecars). */
export function cleanupTmp(): void {
  for (const f of tmpFiles.splice(0)) {
    for (const ext of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(f + ext);
      } catch {
        // never created / already gone
      }
    }
  }
}

/**
 * Reset the module registry and point the DB at a new file, so db.ts's lazy
 * singleton and booths.ts's cache start clean. Import the db/route modules after
 * calling it: they all share that one fresh DB until the next reset.
 */
export function resetApp(): void {
  vi.resetModules();
  process.env.DATA_FILE = freshDataFile();
}

type DbModule = typeof import("@/lib/db");

/** resetApp() plus a fresh import of the db module bound to the new file. */
export async function loadDb(): Promise<DbModule> {
  resetApp();
  return import("@/lib/db");
}

export function adminToken(name = "admin"): string {
  return createSessionToken({ role: "admin", sub: "admin", name });
}

export function userToken(
  sub: string,
  name = "Member",
  email = "member@example.com",
): string {
  return createSessionToken({ role: "user", sub, name, email });
}

export function token(session: Session): string {
  return createSessionToken(session);
}

/**
 * Build a NextRequest with an optional JSON body and session cookie. Pass
 * `rawBody` instead of `body` to send an unserialised payload (e.g. malformed
 * JSON, to exercise a route's `req.json().catch(...)` fallback).
 */
export function makeRequest(
  url: string,
  opts: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    token?: string;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const headers = new Headers(opts.headers ?? {});
  const init: { method: string; headers: Headers; body?: string } = {
    method: opts.method ?? "GET",
    headers,
  };
  if (opts.rawBody !== undefined) {
    headers.set("content-type", "application/json");
    init.body = opts.rawBody;
  } else if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(opts.body);
  }
  if (opts.token) headers.set("cookie", `${SESSION_COOKIE}=${opts.token}`);
  return new NextRequest(new URL(url, "http://localhost"), init);
}

/** Wrap a plain object as the async `params` Next 15 passes to [id] routes. */
export function params<T extends Record<string, string>>(
  p: T,
): { params: Promise<T> } {
  return { params: Promise.resolve(p) };
}
