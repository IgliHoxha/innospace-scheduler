import { NextResponse } from "next/server";

/** The plain failure envelope; a refusal with extra members stays a literal. */
export function jsonError(
  error: string,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers });
}
