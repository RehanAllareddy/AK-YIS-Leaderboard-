import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { deleteSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { assertSameOrigin, NO_STORE, route } from "@/lib/server/http";

export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  await deleteSession(await getDb(), req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
});
