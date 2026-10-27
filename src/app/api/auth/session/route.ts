import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionAdmin, SESSION_COOKIE } from "@/lib/auth/session";
import { NO_STORE, route } from "@/lib/server/http";

export const GET = route(async (req: NextRequest) => {
  const admin = await getSessionAdmin(await getDb(), req.cookies.get(SESSION_COOKIE)?.value);
  return NextResponse.json(
    { admin: admin ? { username: admin.username, displayName: admin.displayName } : null },
    { headers: NO_STORE },
  );
});
