import { NextRequest, NextResponse } from "next/server";
import { memberFrom } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who is booking, for a page the edge caches and so can never say itself. */
export async function GET(req: NextRequest) {
  const member = memberFrom(req);
  return NextResponse.json(
    {
      ok: true,
      member: member ? { name: member.name, email: member.email } : null,
    },
    // Belt and braces with next.config: a cached answer would be someone else's.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
