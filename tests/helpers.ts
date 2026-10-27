import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { createDb, type Db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { setDbForTesting } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const DATA_FILE = path.join(process.cwd(), "data", "leaderboard_2026-10-27.json");
export const readDataFile = () => fs.readFileSync(DATA_FILE, "utf8");

export async function freshDb(): Promise<Db> {
  const db = await createDb("pglite:memory");
  await runMigrations(db);
  setDbForTesting(db);
  return db;
}

export async function createAdmin(db: Db, username = "treasurer", password = "correct horse battery staple") {
  const { rows } = await db.query<{ id: number }>(
    "insert into admins (username, password_hash) values ($1, $2) returning id",
    [username, await hashPassword(password)],
  );
  return { id: rows[0].id, username, displayName: null, password };
}

const ORIGIN = "http://localhost:3000";

export function request(
  method: string,
  pathname: string,
  opts: { body?: unknown; cookie?: string; origin?: string | null; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { host: "localhost:3000", ...opts.headers };
  if (opts.origin !== null && method !== "GET") headers.origin = opts.origin ?? ORIGIN;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  return new NextRequest(new URL(pathname, ORIGIN), {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

export function ctx<P>(params: P) {
  return { params: Promise.resolve(params) };
}

export function sessionFrom(res: Response): string | undefined {
  const header = res.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return match?.[1] || undefined;
}
