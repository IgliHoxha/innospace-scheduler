import { NextRequest, NextResponse } from "next/server";
import { deleteUser } from "@/lib/db";
import { requireAdmin } from "@/lib/api-auth";
import { requireAllowedOrigin } from "@/lib/cors";

export const runtime = "nodejs";

/** Admin-only: remove a member. Their past reservations are kept. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = requireAllowedOrigin(req.headers);
  if (blocked) return blocked;

  const admin = requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

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
