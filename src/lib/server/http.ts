import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "../db";
import { getSessionAdmin, SESSION_COOKIE, type SessionAdmin } from "../auth/session";
import { firstIssue } from "../validation";
import { HttpError } from "./http-error";

export { HttpError };

export function jsonError(status: number, message: string, code?: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { message, code, ...extra } }, { status, headers: NO_STORE });
}

export const NO_STORE = { "Cache-Control": "no-store" };

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Wraps a route handler: converts HttpErrors into JSON responses and hides
 * unexpected errors behind a generic message (details are logged server-side).
 */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.status, error.message, error.code, error.extra);
      }
      console.error(`[api] ${req.method} ${req.nextUrl.pathname} failed:`, error);
      return jsonError(500, "Something went wrong. Please try again.", "INTERNAL");
    }
  };
}

/**
 * CSRF defence for state-changing requests: the session cookie is
 * SameSite=Strict, and we additionally require a same-origin `Origin`
 * header and a JSON body (which cross-site HTML forms cannot send).
 */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) throw new HttpError(403, "Request blocked.", "CSRF");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Request blocked.", "CSRF");
  }
  const allowed = new Set<string>();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) allowed.add(host);
  for (const o of (process.env.APP_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      allowed.add(new URL(o).host);
    } catch {
      // ignore malformed entries
    }
  }
  if (!allowed.has(originHost)) throw new HttpError(403, "Request blocked.", "CSRF");
}

export async function readJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.output<S>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Expected a JSON request body.", "UNSUPPORTED_MEDIA_TYPE");
  }
  const text = await req.text();
  if (text.length > 10_000) throw new HttpError(413, "Request body too large.", "TOO_LARGE");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Malformed JSON body.", "BAD_JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), "VALIDATION");
  return parsed.data;
}

/** Resolves the signed-in administrator or throws 401. */
export async function requireAdmin(req: NextRequest): Promise<SessionAdmin> {
  const db = await getDb();
  const admin = await getSessionAdmin(db, req.cookies.get(SESSION_COOKIE)?.value);
  if (!admin) throw new HttpError(401, "Please sign in to continue.", "UNAUTHENTICATED");
  return admin;
}

/** For mutating admin endpoints: origin check, then authentication. */
export async function requireAdminWrite(req: NextRequest): Promise<SessionAdmin> {
  assertSameOrigin(req);
  return requireAdmin(req);
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
