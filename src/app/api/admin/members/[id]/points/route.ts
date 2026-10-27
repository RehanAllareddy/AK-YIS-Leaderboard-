import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { NO_STORE, readJson, requireAdminWrite, route } from "@/lib/server/http";
import { changePoints } from "@/lib/server/members";
import { pointsChangeSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req: NextRequest, { params }) => {
  const admin = await requireAdminWrite(req);
  const { id } = await params;
  const input = await readJson(req, pointsChangeSchema);
  const result = await changePoints(await getDb(), admin, id, input);
  return NextResponse.json(result, { headers: NO_STORE });
});
