import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";
import { getPublicLeaderboard } from "@/lib/server/members";

export const dynamic = "force-dynamic";

/** Public, read-only. Polled by the leaderboard page; supports ETag revalidation. */
export const GET = route(async (req: NextRequest) => {
  const data = await getPublicLeaderboard(await getDb());
  const body = JSON.stringify(data);
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  const headers = { "Cache-Control": "no-cache", ETag: etag };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new NextResponse(body, { headers: { ...headers, "Content-Type": "application/json" } });
});
