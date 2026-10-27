import type { Queryable } from "../db/client";

export const LOGIN_WINDOW_MINUTES = 15;
/** Failures allowed per (IP, username) pair, per IP, and per username within the window. */
export const LOGIN_LIMITS = { pair: 5, ip: 20, user: 50 } as const;

function keys(ip: string, username: string) {
  return {
    pair: `pair:${ip}:${username}`,
    ip: `ip:${ip}`,
    user: `user:${username}`,
  };
}

/** True when any login-failure budget for this IP/username is exhausted. */
export async function isLoginBlocked(db: Queryable, ip: string, username: string): Promise<boolean> {
  const k = keys(ip, username);
  const { rows } = await db.query<{ key: string; n: number }>(
    `select key, count(*)::int as n
       from login_attempts
      where key = any($1::text[]) and attempted_at > now() - make_interval(mins => $2)
      group by key`,
    [[k.pair, k.ip, k.user], LOGIN_WINDOW_MINUTES],
  );
  const counts = new Map(rows.map((r) => [r.key, r.n]));
  return (
    (counts.get(k.pair) ?? 0) >= LOGIN_LIMITS.pair ||
    (counts.get(k.ip) ?? 0) >= LOGIN_LIMITS.ip ||
    (counts.get(k.user) ?? 0) >= LOGIN_LIMITS.user
  );
}

export async function recordLoginFailure(db: Queryable, ip: string, username: string): Promise<void> {
  const k = keys(ip, username);
  await db.query("insert into login_attempts (key) select unnest($1::text[])", [[k.pair, k.ip, k.user]]);
  await db.query("delete from login_attempts where attempted_at < now() - interval '1 day'");
}

export async function clearLoginFailures(db: Queryable, ip: string, username: string): Promise<void> {
  await db.query("delete from login_attempts where key = $1", [keys(ip, username).pair]);
}
