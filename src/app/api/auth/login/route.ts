import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { clearLoginFailures, isLoginBlocked, LOGIN_WINDOW_MINUTES, recordLoginFailure } from "@/lib/auth/rate-limit";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { assertSameOrigin, clientIp, HttpError, NO_STORE, readJson, route } from "@/lib/server/http";
import { loginSchema } from "@/lib/validation";

const INVALID = "Invalid username or password.";

export const POST = route(async (req: NextRequest) => {
  assertSameOrigin(req);
  let input;
  try {
    input = await readJson(req, loginSchema);
  } catch (error) {
    if (error instanceof HttpError && error.code === "VALIDATION") throw new HttpError(401, INVALID, "INVALID_CREDENTIALS");
    throw error;
  }
  const db = await getDb();
  const ip = clientIp(req);

  if (await isLoginBlocked(db, ip, input.username)) {
    throw new HttpError(
      429,
      `Too many sign-in attempts. Please wait ${LOGIN_WINDOW_MINUTES} minutes and try again.`,
      "RATE_LIMITED",
    );
  }

  const { rows } = await db.query<{ id: number; password_hash: string; is_active: boolean }>(
    "select id, password_hash, is_active from admins where username = $1",
    [input.username],
  );
  const admin = rows[0];
  // Always run a full hash comparison so unknown usernames take as long as wrong passwords.
  const ok = await verifyPassword(input.password, admin?.password_hash ?? (await getDummyHash()));

  if (!admin || !admin.is_active || !ok) {
    await recordLoginFailure(db, ip, input.username);
    throw new HttpError(401, INVALID, "INVALID_CREDENTIALS");
  }

  await clearLoginFailures(db, ip, input.username);
  const token = await createSession(db, admin.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  await db.query("update admins set last_login_at = now() where id = $1", [admin.id]);

  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
