import { vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, createSessionToken, type Session } from "@/lib/auth";

const tmpFiles: string[] = [];

export function freshDataFile(): string {
  const f = path.join(os.tmpdir(), `innospace-test-${randomUUID()}.db`);
  tmpFiles.push(f);
  return f;
}

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

export function resetApp(): void {
  vi.resetModules();
  process.env.DATA_FILE = freshDataFile();
}

type DbModule = typeof import("@/lib/db");

export async function loadDb(): Promise<DbModule> {
  resetApp();
  return import("@/lib/db");
}

export function adminToken(name = "admin"): string {
  return createSessionToken({ role: "admin", sub: "admin", name });
}

export function token(session: Session): string {
  return createSessionToken(session);
}

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
