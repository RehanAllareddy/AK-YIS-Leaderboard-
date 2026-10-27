import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { NO_STORE, requireAdmin, route } from "@/lib/server/http";
import { listAdjustments } from "@/lib/server/members";

function intParam(value: string | null): number | undefined {
  const n = Number(value);
  return value && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export const GET = route(async (req: NextRequest) => {
  await requireAdmin(req);
  const q = req.nextUrl.searchParams;
  const memberId = q.get("memberId")?.slice(0, 64) || undefined;
  const adjustments = await listAdjustments(await getDb(), {
    memberId,
    limit: intParam(q.get("limit")),
    beforeId: intParam(q.get("before")),
  });
  return NextResponse.json({ adjustments }, { headers: NO_STORE });
});
