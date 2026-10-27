import { createHash } from "node:crypto";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { importLeaderboard, LeaderboardFileError, parseLeaderboardFile } from "@/lib/import/leaderboard";
import { changePoints } from "@/lib/server/members";
import { createAdmin, DATA_FILE, freshDb, readDataFile } from "./helpers";

const source = "leaderboard_2026-10-27.json";

describe("leaderboard import", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(async () => {
    await db.close();
  });

  it("imports every member exactly as written in the original file", async () => {
    const file = JSON.parse(readDataFile());
    const summary = await importLeaderboard(db, readDataFile(), { source });

    expect(summary).toMatchObject({ totalRecords: 52, imported: 52, updated: 0, skipped: 0, rejected: 0 });
    expect(summary.warnings).toEqual([]);

    const { rows } = await db.query<{
      id: string;
      name: string;
      score: number;
      status: string;
      legacy_history: number[];
      created_at: Date;
    }>("select id, name, score, status, legacy_history, created_at from members");
    expect(rows).toHaveLength(52);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const p of file.players) {
      const r = byId.get(p.id)!;
      expect(r, p.id).toBeDefined();
      expect(r.name).toBe(p.name); // e.g. "Ehren wang" and "Abel Santiago Escalante Patiño" untouched
      expect(r.score).toBe(p.score);
      expect(r.status).toBe(p.status);
      expect(r.legacy_history).toEqual(p.history);
      expect(r.created_at.getTime()).toBe(p.createdAt);
    }
    const total = rows.reduce((s, r) => s + r.score, 0);
    expect(total).toBe(55);
  });

  it("preserves point settings, app settings and top-level history", async () => {
    await importLeaderboard(db, readDataFile(), { source });
    const { rows } = await db.query<{ key: string; value: unknown }>("select key, value from app_settings order by key");
    const file = JSON.parse(readDataFile());
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual({
      pointSettings: file.pointSettings,
      legacyAppSettings: file.appSettings,
      legacyGlobalHistory: file.history,
    });
  });

  it("is idempotent: a second run imports nothing and creates no duplicates", async () => {
    await importLeaderboard(db, readDataFile(), { source });
    const second = await importLeaderboard(db, readDataFile(), { source });
    expect(second).toMatchObject({ imported: 0, updated: 0, skipped: 52, rejected: 0 });
    expect(second.settings.every((s) => s.result === "unchanged")).toBe(true);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from members");
    expect(rows[0].n).toBe(52);
  });

  it("never overwrites changes made by admins after the first import", async () => {
    await importLeaderboard(db, readDataFile(), { source });
    const admin = await createAdmin(db);
    await changePoints(db, admin, "1791226468231mqj4fzsop", { mode: "adjust", delta: 5, expectedVersion: 1 });

    const rerun = await importLeaderboard(db, readDataFile(), { source });
    expect(rerun).toMatchObject({ imported: 0, updated: 0, skipped: 52 });
    expect(rerun.skippedDetails.find((d) => d.id === "1791226468231mqj4fzsop")?.reason).toMatch(/database kept/);

    const { rows } = await db.query<{ score: number }>("select score from members where id = $1", ["1791226468231mqj4fzsop"]);
    expect(rows[0].score).toBe(12);
  });

  it("only replaces differing members when --overwrite is requested, with an audit trail", async () => {
    await importLeaderboard(db, readDataFile(), { source });
    const admin = await createAdmin(db);
    await changePoints(db, admin, "1791226468231mqj4fzsop", { mode: "adjust", delta: 5, expectedVersion: 1 });

    const rerun = await importLeaderboard(db, readDataFile(), { source, overwrite: true });
    expect(rerun).toMatchObject({ imported: 0, updated: 1, skipped: 51 });
    const { rows } = await db.query<{ score: number }>("select score from members where id = $1", ["1791226468231mqj4fzsop"]);
    expect(rows[0].score).toBe(7);
    const { rows: audit } = await db.query<{ kind: string; previous_score: number; new_score: number }>(
      "select kind, previous_score, new_score from point_adjustments order by id",
    );
    expect(audit.at(-1)).toEqual({ kind: "import", previous_score: 12, new_score: 7 });
  });

  it("dry runs write nothing", async () => {
    const summary = await importLeaderboard(db, readDataFile(), { source, dryRun: true });
    expect(summary.imported).toBe(52);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from members");
    expect(rows[0].n).toBe(0);
  });

  it("reports malformed records instead of silently discarding them", async () => {
    const file = {
      type: "leaderboard_data",
      version: 1,
      players: [
        { id: "ok1", name: "Valid Person", score: 2, history: [1, 1], status: "active", createdAt: 1791226468231 },
        { id: "", name: "No Id", score: 1, history: [], status: "active", createdAt: 1 },
        { id: "bad-score", name: "Bad Score", score: "3", history: [], status: "active", createdAt: 1 },
        { id: "bad-status", name: "Bad Status", score: 0, history: [], status: "gone", createdAt: 1 },
        { id: "ok1", name: "Duplicate", score: 0, history: [], status: "active", createdAt: 1 },
        "not an object",
        { id: "mismatch", name: "Mismatch", score: 9, history: [1], status: "inactive", createdAt: 1 },
      ],
    };
    const summary = await importLeaderboard(db, JSON.stringify(file), { source: "test.json" });
    expect(summary).toMatchObject({ totalRecords: 7, imported: 2, rejected: 5 });
    expect(summary.rejectedDetails.map((r) => r.index)).toEqual([1, 2, 3, 4, 5]);
    expect(summary.rejectedDetails[3].reasons.join(" ")).toMatch(/duplicate id/);
    // Score/history mismatch is a warning; the score is imported as written.
    expect(summary.warnings[0]).toMatch(/Mismatch/);
    const { rows } = await db.query<{ score: number; status: string }>("select score, status from members where id = 'mismatch'");
    expect(rows[0]).toEqual({ score: 9, status: "inactive" });
  });

  it("rejects files that are not leaderboard exports", () => {
    expect(() => parseLeaderboardFile({ type: "other", version: 1, players: [] })).toThrow(LeaderboardFileError);
    expect(() => parseLeaderboardFile({ type: "leaderboard_data", version: 2, players: [] })).toThrow(LeaderboardFileError);
    expect(() => parseLeaderboardFile({ type: "leaderboard_data", version: 1 })).toThrow(LeaderboardFileError);
  });

  it("leaves the original JSON file unchanged", async () => {
    const before = createHash("sha256").update(fs.readFileSync(DATA_FILE)).digest("hex");
    await importLeaderboard(db, readDataFile(), { source });
    await importLeaderboard(db, readDataFile(), { source, overwrite: true });
    const after = createHash("sha256").update(fs.readFileSync(DATA_FILE)).digest("hex");
    expect(after).toBe(before);
  });
});
