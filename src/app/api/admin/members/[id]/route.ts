import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { NO_STORE, readJson, requireAdminWrite, route } from "@/lib/server/http";
import { updateMember } from "@/lib/server/members";
import { updateMemberSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** Rename and/or activate/deactivate. Members are never hard-deleted. */
export const PATCH = route<Ctx>(async (req: NextRequest, { params }) => {
  const admin = await requireAdminWrite(req);
  const { id } = await params;
  const input = await readJson(req, updateMemberSchema);
  const member = await updateMember(await getDb(), admin, id, input);
  return NextResponse.json({ member }, { headers: NO_STORE });
});
