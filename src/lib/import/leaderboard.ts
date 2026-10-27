import { createHash } from "node:crypto";
import type { Db, Queryable } from "../db/client";

/**
 * Importer for the original leaderboard export (leaderboard_YYYY-MM-DD.json).
 *
 * Guarantees:
 *  - Every valid record is imported with its id, name, score, history,
 *    status and createdAt exactly as written — nothing is trimmed,
 *    normalised or recalculated.
 *  - Re-running is safe: members already in the database are left alone
 *    (the database is the source of truth after the first import), unless
 *    `overwrite` is explicitly requested.
 *  - Malformed records are reported, never silently dropped.
 *  - The source file is only ever read.
 */

export interface LegacyPlayer {
  id: string;
  name: string;
  score: number;
  history: number[];
  status: "active" | "inactive";
  createdAt: number;
}

export interface RejectedRecord {
  index: number;
  id?: string;
  name?: string;
  reasons: string[];
}

export interface ParsedLeaderboard {
  players: LegacyPlayer[];
  rejected: RejectedRecord[];
  warnings: string[];
  pointSettings?: Record<string, unknown>;
  appSettings?: Record<string, unknown>;
  globalHistory?: unknown[];
}

export interface ImportSummary {
  source: string;
  sha256: string;
  mode: "insert-only" | "overwrite";
  dryRun: boolean;
  totalRecords: number;
  imported: number;
  updated: number;
  skipped: number;
  rejected: number;
  skippedDetails: { id: string; name: string; reason: string }[];
  rejectedDetails: RejectedRecord[];
  warnings: string[];
  settings: { key: string; result: "imported" | "updated" | "unchanged" | "kept-existing" }[];
}

export class LeaderboardFileError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseLeaderboardFile(raw: unknown): ParsedLeaderboard {
  if (!isObject(raw)) throw new LeaderboardFileError("File is not a JSON object.");
  if (raw.type !== "leaderboard_data") {
    throw new LeaderboardFileError(`Unexpected "type": ${JSON.stringify(raw.type)} (expected "leaderboard_data").`);
  }
  if (raw.version !== 1) {
    throw new LeaderboardFileError(`Unsupported "version": ${JSON.stringify(raw.version)} (expected 1).`);
  }
  if (!Array.isArray(raw.players)) throw new LeaderboardFileError(`"players" must be an array.`);

  const players: LegacyPlayer[] = [];
  const rejected: RejectedRecord[] = [];
  const warnings: string[] = [];
  const seenIds = new Map<string, number>();

  raw.players.forEach((p: unknown, index) => {
    const reasons: string[] = [];
    if (!isObject(p)) {
      rejected.push({ index, reasons: ["Record is not an object."] });
      return;
    }
    const { id, name, score, history, status, createdAt } = p;

    if (typeof id !== "string" || id.length === 0 || id.length > 64) reasons.push("id must be a non-empty string (max 64 chars).");
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
      reasons.push("name must be a non-empty string (max 200 chars).");
    }
    if (typeof score !== "number" || !Number.isSafeInteger(score) || Math.abs(score) > 2_000_000_000) {
      reasons.push("score must be an integer.");
    }
    if (!Array.isArray(history) || !history.every((h) => typeof h === "number" && Number.isSafeInteger(h) && Math.abs(h) <= 2_000_000_000)) {
      reasons.push("history must be an array of integers.");
    }
    if (status !== "active" && status !== "inactive") reasons.push(`status must be "active" or "inactive".`);
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || Number.isNaN(new Date(createdAt).getTime())) {
      reasons.push("createdAt must be a millisecond timestamp.");
    }
    if (typeof id === "string" && seenIds.has(id)) {
      reasons.push(`duplicate id (first seen at record #${seenIds.get(id)}).`);
    }

    if (reasons.length) {
      rejected.push({
        index,
        id: typeof id === "string" ? id : undefined,
        name: typeof name === "string" ? name : undefined,
        reasons,
      });
      return;
    }
    seenIds.set(id as string, index);
    const player: LegacyPlayer = {
      id: id as string,
      name: name as string,
      score: score as number,
      history: [...(history as number[])],
      status: status as LegacyPlayer["status"],
      createdAt: createdAt as number,
    };
    const historySum = player.history.reduce((a, b) => a + b, 0);
    if (player.history.length > 0 && historySum !== player.score) {
      warnings.push(
        `${player.name} (${player.id}): history sums to ${historySum} but score is ${player.score}. Score imported as-is.`,
      );
    }
    players.push(player);
  });

  const result: ParsedLeaderboard = { players, rejected, warnings };
  if (raw.pointSettings !== undefined) {
    if (isObject(raw.pointSettings)) result.pointSettings = raw.pointSettings;
    else warnings.push(`"pointSettings" is not an object and was not imported.`);
  }
  if (raw.appSettings !== undefined) {
    if (isObject(raw.appSettings)) result.appSettings = raw.appSettings;
    else warnings.push(`"appSettings" is not an object and was not imported.`);
  }
  if (raw.history !== undefined) {
    if (Array.isArray(raw.history)) result.globalHistory = raw.history;
    else warnings.push(`Top-level "history" is not an array and was not imported.`);
  }
  return result;
}

const IMPORT_ACTOR = "system:import";

interface ExistingRow {
  name: string;
  score: number;
  status: string;
  legacy_history: number[];
  created_at: Date;
}

function differences(row: ExistingRow, p: LegacyPlayer): string[] {
  const diffs: string[] = [];
  if (row.name !== p.name) diffs.push("name");
  if (row.score !== p.score) diffs.push("score");
  if (row.status !== p.status) diffs.push("status");
  if (JSON.stringify(row.legacy_history) !== JSON.stringify(p.history)) diffs.push("history");
  if (row.created_at.getTime() !== p.createdAt) diffs.push("createdAt");
  return diffs;
}

class DryRunRollback extends Error {}

export async function importLeaderboard(
  db: Db,
  fileContents: string,
  opts: { source: string; overwrite?: boolean; dryRun?: boolean },
): Promise<ImportSummary> {
  let raw: unknown;
  try {
    raw = JSON.parse(fileContents);
  } catch (error) {
    throw new LeaderboardFileError(`File is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = parseLeaderboardFile(raw);
  const sha256 = createHash("sha256").update(fileContents).digest("hex");
  const overwrite = Boolean(opts.overwrite);

  const summary: ImportSummary = {
    source: opts.source,
    sha256,
    mode: overwrite ? "overwrite" : "insert-only",
    dryRun: Boolean(opts.dryRun),
    totalRecords: (raw as { players: unknown[] }).players.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    rejected: parsed.rejected.length,
    skippedDetails: [],
    rejectedDetails: parsed.rejected,
    warnings: parsed.warnings,
    settings: [],
  };

  const work = async (tx: Queryable) => {
    for (const p of parsed.players) {
      const { rows } = await tx.query<ExistingRow>(
        "select name, score, status, legacy_history, created_at from members where id = $1 for update",
        [p.id],
      );
      const existing = rows[0];
      if (!existing) {
        await tx.query(
          `insert into members (id, name, score, status, legacy_history, created_at, updated_at, imported_at)
           values ($1, $2, $3, $4, $5::int[], $6::timestamptz, now(), now())`,
          [p.id, p.name, p.score, p.status, p.history, new Date(p.createdAt).toISOString()],
        );
        await tx.query(
          `insert into member_events (member_id, action, details, admin_username) values ($1, 'imported', $2::jsonb, $3)`,
          [p.id, JSON.stringify({ source: opts.source, score: p.score, status: p.status }), IMPORT_ACTOR],
        );
        summary.imported++;
        continue;
      }

      const diffs = differences(existing, p);
      if (diffs.length === 0) {
        summary.skipped++;
        summary.skippedDetails.push({ id: p.id, name: p.name, reason: "already imported (identical)" });
        continue;
      }
      if (!overwrite) {
        summary.skipped++;
        summary.skippedDetails.push({
          id: p.id,
          name: p.name,
          reason: `already in database with different ${diffs.join(", ")}; database kept (use --overwrite to replace)`,
        });
        continue;
      }

      await tx.query(
        `update members
            set name = $2, score = $3, status = $4, legacy_history = $5::int[],
                created_at = $6::timestamptz,
                version = version + 1, updated_at = now(), imported_at = now()
          where id = $1`,
        [p.id, p.name, p.score, p.status, p.history, new Date(p.createdAt).toISOString()],
      );
      if (existing.score !== p.score) {
        await tx.query(
          `insert into point_adjustments (member_id, previous_score, new_score, delta, kind, reason, admin_username)
           values ($1, $2, $3, $4, 'import', $5, $6)`,
          [p.id, existing.score, p.score, p.score - existing.score, `Overwritten from ${opts.source}`, IMPORT_ACTOR],
        );
      }
      await tx.query(
        `insert into member_events (member_id, action, details, admin_username) values ($1, 'import_updated', $2::jsonb, $3)`,
        [p.id, JSON.stringify({ source: opts.source, fields: diffs }), IMPORT_ACTOR],
      );
      summary.updated++;
    }

    const settings: [string, unknown][] = [];
    if (parsed.pointSettings) settings.push(["pointSettings", parsed.pointSettings]);
    if (parsed.appSettings) settings.push(["legacyAppSettings", parsed.appSettings]);
    if (parsed.globalHistory) settings.push(["legacyGlobalHistory", parsed.globalHistory]);
    for (const [key, value] of settings) {
      const json = JSON.stringify(value);
      const { rows } = await tx.query<{ same: boolean }>(
        "select value = $2::jsonb as same from app_settings where key = $1 for update",
        [key, json],
      );
      if (!rows[0]) {
        await tx.query("insert into app_settings (key, value, updated_by) values ($1, $2::jsonb, $3)", [key, json, IMPORT_ACTOR]);
        summary.settings.push({ key, result: "imported" });
      } else if (rows[0].same) {
        summary.settings.push({ key, result: "unchanged" });
      } else if (overwrite) {
        await tx.query("update app_settings set value = $2::jsonb, updated_at = now(), updated_by = $3 where key = $1", [
          key,
          json,
          IMPORT_ACTOR,
        ]);
        summary.settings.push({ key, result: "updated" });
      } else {
        summary.settings.push({ key, result: "kept-existing" });
      }
    }

    // Per-member skip details are noise in the stored record; counts suffice.
    const stored = { ...summary, skippedDetails: undefined };
    await tx.query("insert into import_runs (source, sha256, mode, summary) values ($1, $2, $3, $4::jsonb)", [
      opts.source,
      sha256,
      summary.mode,
      JSON.stringify(stored),
    ]);
    if (opts.dryRun) throw new DryRunRollback();
  };

  try {
    await db.transaction(work);
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return summary;
}

export function formatSummary(s: ImportSummary): string {
  const lines = [
    `${s.dryRun ? "[DRY RUN — nothing was written] " : ""}Import of ${s.source} (${s.mode})`,
    `  sha256:   ${s.sha256}`,
    `  records:  ${s.totalRecords}`,
    `  imported: ${s.imported}`,
    `  updated:  ${s.updated}`,
    `  skipped:  ${s.skipped}`,
    `  rejected: ${s.rejected}`,
  ];
  const conflicts = s.skippedDetails.filter((d) => !d.reason.startsWith("already imported"));
  if (conflicts.length) {
    lines.push("", "Skipped (database differs from file):");
    for (const d of conflicts) lines.push(`  - ${d.name} (${d.id}): ${d.reason}`);
  }
  if (s.rejectedDetails.length) {
    lines.push("", "Rejected records:");
    for (const r of s.rejectedDetails) {
      lines.push(`  - #${r.index}${r.id ? ` ${r.id}` : ""}${r.name ? ` "${r.name}"` : ""}: ${r.reasons.join(" ")}`);
    }
  }
  if (s.settings.length) {
    lines.push("", "Settings:");
    for (const st of s.settings) lines.push(`  - ${st.key}: ${st.result}`);
  }
  if (s.warnings.length) {
    lines.push("", "Warnings:");
    for (const w of s.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n");
}
