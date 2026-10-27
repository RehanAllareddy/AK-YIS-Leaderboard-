import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { NO_STORE, readJson, requireAdmin, requireAdminWrite, route } from "@/lib/server/http";
import { getPointSettings, savePointSettings } from "@/lib/server/members";
import { pointSettingsSchema } from "@/lib/validation";

export const GET = route(async (req: NextRequest) => {
  await requireAdmin(req);
  const db = await getDb();
  const { rows } = await db.query<{ source: string; created_at: Date; summary: Record<string, unknown> }>(
    "select source, created_at, summary from import_runs where summary->>'dryRun' = 'false' order by id desc limit 1",
  );
  return NextResponse.json(
    {
      pointSettings: await getPointSettings(db),
      lastImport: rows[0]
        ? { source: rows[0].source, at: rows[0].created_at.toISOString(), summary: rows[0].summary }
        : null,
    },
    { headers: NO_STORE },
  );
});

export const PUT = route(async (req: NextRequest) => {
  const admin = await requireAdminWrite(req);
  const { pointSettings } = await readJson(req, z.object({ pointSettings: pointSettingsSchema }));
  return NextResponse.json(
    { pointSettings: await savePointSettings(await getDb(), admin, pointSettings) },
    { headers: NO_STORE },
  );
});
