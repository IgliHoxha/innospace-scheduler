import { NextRequest, NextResponse } from "next/server";
import { deleteUser } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

/** Admin-only: remove a member. Their past reservations are kept. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (session?.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { id } = await params;
  const removed = await deleteUser(id);
  if (!removed) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
