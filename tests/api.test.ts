import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { importLeaderboard } from "@/lib/import/leaderboard";
import { LOGIN_LIMITS } from "@/lib/auth/rate-limit";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import * as leaderboard from "@/app/api/leaderboard/route";
import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as session from "@/app/api/auth/session/route";
import * as members from "@/app/api/admin/members/route";
import * as member from "@/app/api/admin/members/[id]/route";
import * as points from "@/app/api/admin/members/[id]/points/route";
import * as history from "@/app/api/admin/history/route";
import * as events from "@/app/api/admin/events/route";
import * as settings from "@/app/api/admin/settings/route";
import { createAdmin, ctx, freshDb, readDataFile, request, sessionFrom } from "./helpers";

const ANGAD = "1791226468231mqj4fzsop";
const none = ctx({});
const idCtx = ctx({ id: ANGAD });

async function signIn(username = "treasurer", password = "correct horse battery staple") {
  const res = await login.POST(request("POST", "/api/auth/login", { body: { username, password } }), none);
  return { res, token: sessionFrom(res) };
}

describe("password hashing", () => {
  it("verifies only the right password and rejects malformed hashes", async () => {
    const hash = await hashPassword("a long enough password");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("a long enough password", hash)).toBe(true);
    expect(await verifyPassword("a long enough passworD", hash)).toBe(false);
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "scrypt$99999999999$8$1$AA==$AA==")).toBe(false);
  });
});

describe("API authentication & authorization", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    await importLeaderboard(db, readDataFile(), { source: "test" });
    await createAdmin(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("serves the public leaderboard without auth, exposing only public fields", async () => {
    const res = await leaderboard.GET(request("GET", "/api/leaderboard"), none);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals).toEqual({ activeMembers: 52, totalPoints: 55 });
    expect(Object.keys(body.members[0]).sort()).toEqual(["id", "name", "rank", "score"]);
    expect(body.members.slice(0, 2).map((m: { name: string; rank: number }) => [m.name, m.rank])).toEqual([
      ["Angad Anantula", 1],
      ["James Stewart", 1],
    ]);
    const etag = res.headers.get("etag")!;
    const cached = await leaderboard.GET(request("GET", "/api/leaderboard", { headers: { "if-none-match": etag } }), none);
    expect(cached.status).toBe(304);
  });

  it("rejects every admin endpoint without a session", async () => {
    const calls: Promise<Response>[] = [
      members.GET(request("GET", "/api/admin/members"), none),
      members.POST(request("POST", "/api/admin/members", { body: { name: "Intruder" } }), none),
      member.PATCH(request("PATCH", `/api/admin/members/${ANGAD}`, { body: { status: "inactive", expectedVersion: 1 } }), idCtx),
      points.POST(
        request("POST", `/api/admin/members/${ANGAD}/points`, { body: { mode: "set", score: 999, expectedVersion: 1, confirmed: true } }),
        idCtx,
      ),
      history.GET(request("GET", "/api/admin/history"), none),
      events.GET(request("GET", "/api/admin/events"), none),
      settings.GET(request("GET", "/api/admin/settings"), none),
      settings.PUT(request("PUT", "/api/admin/settings", { body: { pointSettings: { btn1: 1, btn2: 1, btn3: 1, btn4: 1 } } }), none),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
    // Forged / random tokens are rejected too.
    const forged = await members.GET(request("GET", "/api/admin/members", { cookie: "not-a-real-session" }), none);
    expect(forged.status).toBe(401);

    const { rows } = await db.query<{ score: number; status: string }>("select score, status from members where id = $1", [ANGAD]);
    expect(rows[0]).toEqual({ score: 7, status: "active" });
  });

  it("uses the same generic error for unknown users and wrong passwords", async () => {
    const wrongPass = await signIn("treasurer", "wrong password!!");
    const noUser = await signIn("nobody", "correct horse battery staple");
    expect(wrongPass.res.status).toBe(401);
    expect(noUser.res.status).toBe(401);
    expect(await wrongPass.res.json()).toEqual(await noUser.res.json());
    expect(wrongPass.token).toBeUndefined();
  });

  it("signs in with a secure, httpOnly session cookie and allows admin actions", async () => {
    const { res, token } = await signIn();
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(token).toBeTruthy();
    // Only a hash of the token is stored.
    const { rows } = await db.query<{ token_hash: string }>("select token_hash from admin_sessions");
    expect(rows[0].token_hash).not.toBe(token);

    const me = await (await session.GET(request("GET", "/api/auth/session", { cookie: token }), none)).json();
    expect(me.admin.username).toBe("treasurer");

    const change = await points.POST(
      request("POST", `/api/admin/members/${ANGAD}/points`, {
        cookie: token,
        body: { mode: "adjust", delta: 1, reason: "Meeting attendance", expectedVersion: 1 },
      }),
      idCtx,
    );
    expect(change.status).toBe(200);
    expect((await change.json()).member.score).toBe(8);

    // The adjustment is attributed to the session's admin, not anything client-supplied.
    const hist = await (await history.GET(request("GET", "/api/admin/history", { cookie: token }), none)).json();
    expect(hist.adjustments[0]).toMatchObject({ adminUsername: "treasurer", previousScore: 7, newScore: 8 });

    const board = await (await leaderboard.GET(request("GET", "/api/leaderboard"), none)).json();
    expect(board.members[0]).toMatchObject({ name: "Angad Anantula", score: 8, rank: 1 });
  });

  it("ignores client-supplied admin ids and scores in the payload", async () => {
    const { token } = await signIn();
    const res = await points.POST(
      request("POST", `/api/admin/members/${ANGAD}/points`, {
        cookie: token,
        body: { mode: "adjust", delta: 1, expectedVersion: 1, adminId: 999, adminUsername: "someone-else", previousScore: 0 },
      }),
      idCtx,
    );
    const body = await res.json();
    expect(body.adjustment).toMatchObject({ adminUsername: "treasurer", previousScore: 7, newScore: 8 });
  });

  it("blocks cross-site writes even with a valid session (CSRF)", async () => {
    const { token } = await signIn();
    const evil = await points.POST(
      request("POST", `/api/admin/members/${ANGAD}/points`, {
        cookie: token,
        origin: "https://evil.example",
        body: { mode: "adjust", delta: 1, expectedVersion: 1 },
      }),
      idCtx,
    );
    expect(evil.status).toBe(403);
    const noOrigin = await points.POST(
      request("POST", `/api/admin/members/${ANGAD}/points`, { cookie: token, origin: null, body: { mode: "adjust", delta: 1, expectedVersion: 1 } }),
      idCtx,
    );
    expect(noOrigin.status).toBe(403);
    const crossLogin = await login.POST(
      request("POST", "/api/auth/login", { origin: "https://evil.example", body: { username: "treasurer", password: "x" } }),
      none,
    );
    expect(crossLogin.status).toBe(403);
  });

  it("validates input on the server", async () => {
    const { token } = await signIn();
    const bad = [
      { mode: "adjust", delta: 1.5, expectedVersion: 1 },
      { mode: "adjust", delta: 0, expectedVersion: 1 },
      { mode: "set", score: -4, expectedVersion: 1 },
      { mode: "set", score: "12", expectedVersion: 1 },
      { mode: "teleport", expectedVersion: 1 },
    ];
    for (const body of bad) {
      const res = await points.POST(request("POST", `/api/admin/members/${ANGAD}/points`, { cookie: token, body }), idCtx);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const blankName = await members.POST(request("POST", "/api/admin/members", { cookie: token, body: { name: "   " } }), none);
    expect(blankName.status).toBe(400);
    const missing = await member.PATCH(request("PATCH", "/api/admin/members/nope", { cookie: token, body: { status: "inactive", expectedVersion: 1 } }), ctx({ id: "nope" }));
    expect(missing.status).toBe(404);
  });

  it("logout invalidates the session server-side", async () => {
    const { token } = await signIn();
    const res = await logout.POST(request("POST", "/api/auth/logout", { cookie: token }), none);
    expect(res.status).toBe(200);
    const after = await members.GET(request("GET", "/api/admin/members", { cookie: token }), none);
    expect(after.status).toBe(401);
  });

  it("deactivated admins lose access immediately", async () => {
    const { token } = await signIn();
    await db.query("update admins set is_active = false");
    const res = await members.GET(request("GET", "/api/admin/members", { cookie: token }), none);
    expect(res.status).toBe(401);
    expect((await signIn()).res.status).toBe(401);
  });

  it("expired sessions are rejected", async () => {
    const { token } = await signIn();
    await db.query("update admin_sessions set expires_at = now() - interval '1 second'");
    const res = await members.GET(request("GET", "/api/admin/members", { cookie: token }), none);
    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failed logins, even with the right password", async () => {
    for (let i = 0; i < LOGIN_LIMITS.pair; i++) {
      expect((await signIn("treasurer", "wrong password!!")).res.status).toBe(401);
    }
    const blocked = await signIn();
    expect(blocked.res.status).toBe(429);
    expect(blocked.token).toBeUndefined();
  });

  it("never exposes internal errors", async () => {
    const { token } = await signIn();
    await db.exec("drop trigger point_adjustments_append_only on point_adjustments; drop table point_adjustments");
    const res = await points.POST(
      request("POST", `/api/admin/members/${ANGAD}/points`, { cookie: token, body: { mode: "adjust", delta: 1, expectedVersion: 1 } }),
      idCtx,
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/point_adjustments|relation|stack/i);
  });
});
