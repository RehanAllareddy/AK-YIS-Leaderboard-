import { randomBytes } from "node:crypto";
import type { Db, Queryable } from "../db/client";
import type { SessionAdmin } from "../auth/session";
import { DEFAULT_POINT_SETTINGS, MAX_SCORE, MIN_SCORE } from "../constants";
import { requiresConfirmation } from "../points";
import { rankMembers } from "../ranking";
import type { CreateMemberInput, PointSettings, PointsChangeInput, UpdateMemberInput } from "../validation";
import { HttpError } from "./http-error";

export interface PublicLeaderboard {
  members: { id: string; name: string; score: number; rank: number }[];
  totals: { activeMembers: number; totalPoints: number };
  updatedAt: string | null;
}

export interface AdminMember {
  id: string;
  name: string;
  score: number;
  status: "active" | "inactive";
  version: number;
  createdAt: string;
  updatedAt: string;
  legacyHistory: number[];
}

export interface PointAdjustment {
  id: number;
  memberId: string;
  memberName: string;
  previousScore: number;
  newScore: number;
  delta: number;
  kind: "adjust" | "set" | "reset" | "import";
  reason: string | null;
  adminUsername: string;
  createdAt: string;
}

export interface MemberEvent {
  id: number;
  memberId: string;
  memberName: string;
  action: string;
  details: Record<string, unknown>;
  adminUsername: string;
  createdAt: string;
}

interface MemberRow {
  id: string;
  name: string;
  score: number;
  status: "active" | "inactive";
  version: number;
  created_at: Date;
  updated_at: Date;
  legacy_history: number[];
}

const MEMBER_COLUMNS = "id, name, score, status, version, created_at, updated_at, legacy_history";

function toAdminMember(row: MemberRow): AdminMember {
  return {
    id: row.id,
    name: row.name,
    score: row.score,
    status: row.status,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    legacyHistory: row.legacy_history,
  };
}

/** Same shape as the original app's ids: millisecond timestamp + 9 random base-36 chars. */
export function generateMemberId(now = Date.now()): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(9);
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % 36];
  return `${now}${suffix}`;
}

// --- Public ---------------------------------------------------------------

/** Only active members, and only the fields the leaderboard displays. */
export async function getPublicLeaderboard(db: Queryable): Promise<PublicLeaderboard> {
  const { rows } = await db.query<{ id: string; name: string; score: number }>(
    "select id, name, score from members where status = 'active'",
  );
  const { rows: meta } = await db.query<{ updated_at: Date | null }>(
    "select max(updated_at) as updated_at from members",
  );
  const members = rankMembers(rows).map(({ id, name, score, rank }) => ({ id, name, score, rank }));
  return {
    members,
    totals: {
      activeMembers: members.length,
      totalPoints: members.reduce((sum, m) => sum + m.score, 0),
    },
    updatedAt: meta[0]?.updated_at ? new Date(meta[0].updated_at).toISOString() : null,
  };
}

// --- Admin: members -------------------------------------------------------

export async function listMembers(db: Queryable): Promise<AdminMember[]> {
  const { rows } = await db.query<MemberRow>(`select ${MEMBER_COLUMNS} from members`);
  return rankMembers(rows).map(toAdminMember);
}

async function lockMember(tx: Queryable, id: string): Promise<MemberRow> {
  const { rows } = await tx.query<MemberRow>(`select ${MEMBER_COLUMNS} from members where id = $1 for update`, [id]);
  if (!rows[0]) throw new HttpError(404, "Member not found.", "NOT_FOUND");
  return rows[0];
}

function assertVersion(row: MemberRow, expectedVersion: number) {
  if (row.version !== expectedVersion) {
    throw new HttpError(
      409,
      `${row.name} was changed by someone else. The latest values have been loaded — please review and try again.`,
      "STALE",
      { member: toAdminMember(row) },
    );
  }
}

async function assertUniqueName(tx: Queryable, name: string, exceptId?: string) {
  const { rows } = await tx.query<{ id: string }>(
    "select id from members where lower(name) = lower($1) and ($2::text is null or id <> $2) limit 1",
    [name, exceptId ?? null],
  );
  if (rows[0]) throw new HttpError(409, `A member named “${name}” already exists.`, "DUPLICATE_NAME");
}

async function logEvent(
  tx: Queryable,
  memberId: string,
  action: string,
  details: Record<string, unknown>,
  actor: { id: number | null; username: string },
) {
  await tx.query(
    `insert into member_events (member_id, action, details, admin_id, admin_username)
     values ($1, $2, $3::jsonb, $4, $5)`,
    [memberId, action, JSON.stringify(details), actor.id, actor.username],
  );
}

export async function createMember(db: Db, admin: SessionAdmin, input: CreateMemberInput): Promise<AdminMember> {
  return db.transaction(async (tx) => {
    // Serialise member creation so the duplicate-name check can't race.
    await tx.query("select pg_advisory_xact_lock(4242001)");
    await assertUniqueName(tx, input.name);
    const id = generateMemberId();
    const { rows } = await tx.query<MemberRow>(
      `insert into members (id, name, score, status) values ($1, $2, $3, 'active') returning ${MEMBER_COLUMNS}`,
      [id, input.name, input.initialScore],
    );
    await logEvent(tx, id, "created", { name: input.name, initialScore: input.initialScore }, admin);
    if (input.initialScore !== 0) {
      await tx.query(
        `insert into point_adjustments (member_id, previous_score, new_score, delta, kind, reason, admin_id, admin_username)
         values ($1, 0, $2, $2, 'set', 'Initial points', $3, $4)`,
        [id, input.initialScore, admin.id, admin.username],
      );
    }
    return toAdminMember(rows[0]);
  });
}

export async function updateMember(
  db: Db,
  admin: SessionAdmin,
  id: string,
  input: UpdateMemberInput,
): Promise<AdminMember> {
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(4242001)");
    const current = await lockMember(tx, id);
    assertVersion(current, input.expectedVersion);

    const nameChanged = input.name !== undefined && input.name !== current.name;
    const statusChanged = input.status !== undefined && input.status !== current.status;
    if (!nameChanged && !statusChanged) return toAdminMember(current);
    if (nameChanged) await assertUniqueName(tx, input.name!, id);

    const { rows } = await tx.query<MemberRow>(
      `update members
          set name = $2, status = $3, version = version + 1, updated_at = now()
        where id = $1
      returning ${MEMBER_COLUMNS}`,
      [id, nameChanged ? input.name : current.name, statusChanged ? input.status : current.status],
    );
    if (nameChanged) await logEvent(tx, id, "renamed", { from: current.name, to: input.name }, admin);
    if (statusChanged) {
      await logEvent(tx, id, input.status === "active" ? "reactivated" : "deactivated", {}, admin);
    }
    return toAdminMember(rows[0]);
  });
}

// --- Admin: points --------------------------------------------------------

export interface PointsChangeResult {
  member: AdminMember;
  adjustment: PointAdjustment;
}

/**
 * Applies a point change and its audit record atomically. The member row is
 * locked and its version checked, so a change based on stale data is
 * rejected instead of silently overwriting a newer total.
 */
export async function changePoints(
  db: Db,
  admin: SessionAdmin,
  id: string,
  input: PointsChangeInput,
): Promise<PointsChangeResult> {
  return db.transaction(async (tx) => {
    const current = await lockMember(tx, id);
    assertVersion(current, input.expectedVersion);

    const newScore = input.mode === "adjust" ? current.score + input.delta : input.score;
    const delta = newScore - current.score;
    if (delta === 0) throw new HttpError(400, "That change would leave the total unchanged.", "NO_CHANGE");
    if (newScore < MIN_SCORE) {
      throw new HttpError(400, `${current.name} has ${current.score} points; the total cannot go below ${MIN_SCORE}.`, "OUT_OF_RANGE");
    }
    if (newScore > MAX_SCORE) throw new HttpError(400, "That total is too large.", "OUT_OF_RANGE");

    const kind = input.mode === "set" ? (newScore === 0 ? "reset" : "set") : "adjust";
    if (requiresConfirmation(current.score, newScore) && !input.confirmed) {
      throw new HttpError(409, "This is a large change. Please confirm it.", "CONFIRMATION_REQUIRED", {
        previousScore: current.score,
        newScore,
      });
    }

    const { rows } = await tx.query<MemberRow>(
      `update members set score = $2, version = version + 1, updated_at = now()
        where id = $1 returning ${MEMBER_COLUMNS}`,
      [id, newScore],
    );
    const { rows: audit } = await tx.query<{ id: number; created_at: Date }>(
      `insert into point_adjustments (member_id, previous_score, new_score, delta, kind, reason, admin_id, admin_username)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, created_at`,
      [id, current.score, newScore, delta, kind, input.reason || null, admin.id, admin.username],
    );
    return {
      member: toAdminMember(rows[0]),
      adjustment: {
        id: audit[0].id,
        memberId: id,
        memberName: current.name,
        previousScore: current.score,
        newScore,
        delta,
        kind,
        reason: input.reason || null,
        adminUsername: admin.username,
        createdAt: audit[0].created_at.toISOString(),
      },
    };
  });
}

// --- Admin: audit ---------------------------------------------------------

export async function listAdjustments(
  db: Queryable,
  opts: { memberId?: string; limit?: number; beforeId?: number } = {},
): Promise<PointAdjustment[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const { rows } = await db.query<{
    id: number;
    member_id: string;
    member_name: string;
    previous_score: number;
    new_score: number;
    delta: number;
    kind: PointAdjustment["kind"];
    reason: string | null;
    admin_username: string;
    created_at: Date;
  }>(
    `select p.id, p.member_id, m.name as member_name, p.previous_score, p.new_score, p.delta,
            p.kind, p.reason, p.admin_username, p.created_at
       from point_adjustments p
       join members m on m.id = p.member_id
      where ($1::text is null or p.member_id = $1)
        and ($2::int is null or p.id < $2)
      order by p.id desc
      limit $3`,
    [opts.memberId ?? null, opts.beforeId ?? null, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    memberName: r.member_name,
    previousScore: r.previous_score,
    newScore: r.new_score,
    delta: r.delta,
    kind: r.kind,
    reason: r.reason,
    adminUsername: r.admin_username,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function listMemberEvents(
  db: Queryable,
  opts: { limit?: number; beforeId?: number } = {},
): Promise<MemberEvent[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const { rows } = await db.query<{
    id: number;
    member_id: string;
    member_name: string;
    action: string;
    details: Record<string, unknown>;
    admin_username: string;
    created_at: Date;
  }>(
    `select e.id, e.member_id, m.name as member_name, e.action, e.details, e.admin_username, e.created_at
       from member_events e
       join members m on m.id = e.member_id
      where ($1::int is null or e.id < $1)
      order by e.id desc
      limit $2`,
    [opts.beforeId ?? null, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    memberName: r.member_name,
    action: r.action,
    details: r.details,
    adminUsername: r.admin_username,
    createdAt: r.created_at.toISOString(),
  }));
}

// --- Settings -------------------------------------------------------------

export async function getPointSettings(db: Queryable): Promise<PointSettings> {
  const { rows } = await db.query<{ value: PointSettings }>("select value from app_settings where key = 'pointSettings'");
  return { ...DEFAULT_POINT_SETTINGS, ...(rows[0]?.value ?? {}) };
}

export async function savePointSettings(db: Queryable, admin: SessionAdmin, value: PointSettings): Promise<PointSettings> {
  await db.query(
    `insert into app_settings (key, value, updated_at, updated_by) values ('pointSettings', $1::jsonb, now(), $2)
     on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
    [JSON.stringify(value), admin.username],
  );
  return value;
}
