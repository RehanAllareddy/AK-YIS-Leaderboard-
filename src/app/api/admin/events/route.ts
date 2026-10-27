import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { NO_STORE, requireAdmin, route } from "@/lib/server/http";
import { listMemberEvents } from "@/lib/server/members";

export const GET = route(async (req: NextRequest) => {
  await requireAdmin(req);
  const before = Number(req.nextUrl.searchParams.get("before"));
  const events = await listMemberEvents(await getDb(), {
    beforeId: Number.isSafeInteger(before) && before > 0 ? before : undefined,
  });
  return NextResponse.json({ events }, { headers: NO_STORE });
});
