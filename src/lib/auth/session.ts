import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "../db/client";

export const SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * `__Host-` cookies must be Secure, path=/, and host-only, which browsers
 * enforce. Plain-http local development can't satisfy that, so dev uses a
 * plain name.
 */
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-akyis_session" : "akyis_session";

export interface SessionAdmin {
  id: number;
  username: string;
  displayName: string | null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function createSession(
  db: Queryable,
  adminId: number,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `insert into admin_sessions (token_hash, admin_id, expires_at, ip, user_agent)
     values ($1, $2, now() + make_interval(secs => $3), $4, $5)`,
    [hashToken(token), adminId, SESSION_TTL_SECONDS, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null],
  );
  // Opportunistic cleanup of expired sessions.
  await db.query("delete from admin_sessions where expires_at < now()");
  return token;
}

export async function getSessionAdmin(db: Queryable, token: string | undefined): Promise<SessionAdmin | null> {
  if (!token || token.length > 200) return null;
  const { rows } = await db.query<{ id: number; username: string; display_name: string | null }>(
    `select a.id, a.username, a.display_name
       from admin_sessions s
       join admins a on a.id = s.admin_id
      where s.token_hash = $1 and s.expires_at > now() and a.is_active`,
    [hashToken(token)],
  );
  const row = rows[0];
  return row ? { id: row.id, username: row.username, displayName: row.display_name } : null;
}

export async function deleteSession(db: Queryable, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.query("delete from admin_sessions where token_hash = $1", [hashToken(token)]);
}
