import "server-only";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { getSessionAdmin, SESSION_COOKIE, type SessionAdmin } from "./session";

/** The signed-in admin for the current request (Server Components only). */
export async function getCurrentAdmin(): Promise<SessionAdmin | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionAdmin(await getDb(), token);
}
