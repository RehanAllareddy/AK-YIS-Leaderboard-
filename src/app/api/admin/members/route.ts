import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { NO_STORE, readJson, requireAdmin, requireAdminWrite, route } from "@/lib/server/http";
import { createMember, listMembers } from "@/lib/server/members";
import { createMemberSchema } from "@/lib/validation";

export const GET = route(async (req: NextRequest) => {
  await requireAdmin(req);
  return NextResponse.json({ members: await listMembers(await getDb()) }, { headers: NO_STORE });
});

export const POST = route(async (req: NextRequest) => {
  const admin = await requireAdminWrite(req);
  const input = await readJson(req, createMemberSchema);
  const member = await createMember(await getDb(), admin, input);
  return NextResponse.json({ member }, { status: 201, headers: NO_STORE });
});
