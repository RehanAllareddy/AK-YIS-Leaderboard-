import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { importLeaderboard } from "@/lib/import/leaderboard";
import { HttpError } from "@/lib/server/http-error";
import { changePoints, createMember, getPublicLeaderboard, listAdjustments, updateMember } from "@/lib/server/members";
import { rankMembers } from "@/lib/ranking";
import { createAdmin, freshDb, readDataFile } from "./helpers";

const ANGAD = "1791226468231mqj4fzsop"; // 7 points
const ANANYA = "1791226468231lp2p4x6my"; // 0 points

async function expectHttpError(p: Promise<unknown>, status: number, code: string) {
  const error = await p.then(
    () => null,
    (e) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ status, code });
}

describe("point management", () => {
  let db: Db;
  let admin: Awaited<ReturnType<typeof createAdmin>>;
  beforeEach(async () => {
    db = await freshDb();
    await importLeaderboard(db, readDataFile(), { source: "test" });
    admin = await createAdmin(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("adjusts points and records a full audit entry", async () => {
    const { member, adjustment } = await changePoints(db, admin, ANGAD, {
      mode: "adjust",
      delta: 5,
      reason: "Stock pitch",
      expectedVersion: 1,
    });
    expect(member).toMatchObject({ score: 12, version: 2 });
    expect(adjustment).toMatchObject({
      memberId: ANGAD,
      memberName: "Angad Anantula",
      previousScore: 7,
      newScore: 12,
      delta: 5,
      kind: "adjust",
      reason: "Stock pitch",
      adminUsername: "treasurer",
    });
    const history = await listAdjustments(db, { memberId: ANGAD });
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(adjustment);
  });

  it("supports negative adjustments and setting an exact total", async () => {
    await changePoints(db, admin, ANGAD, { mode: "adjust", delta: -2, expectedVersion: 1 });
    const { member, adjustment } = await changePoints(db, admin, ANGAD, { mode: "set", score: 9, expectedVersion: 2 });
    expect(member.score).toBe(9);
    expect(adjustment).toMatchObject({ previousScore: 5, newScore: 9, delta: 4, kind: "set" });
  });

  it("refuses to take a total below zero", async () => {
    await expectHttpError(changePoints(db, admin, ANANYA, { mode: "adjust", delta: -1, expectedVersion: 1 }), 400, "OUT_OF_RANGE");
  });

  it("rejects stale updates instead of overwriting newer data", async () => {
    await changePoints(db, admin, ANGAD, { mode: "adjust", delta: 1, expectedVersion: 1 });
    // A second admin still looking at version 1:
    await expectHttpError(changePoints(db, admin, ANGAD, { mode: "set", score: 100, expectedVersion: 1, confirmed: true }), 409, "STALE");
    const { rows } = await db.query<{ score: number }>("select score from members where id = $1", [ANGAD]);
    expect(rows[0].score).toBe(8);
  });

  it("applies concurrent adjustments without losing any", async () => {
    // Each request reads the latest version first, as the UI does after a conflict.
    for (let i = 0; i < 5; i++) {
      const { rows } = await db.query<{ version: number }>("select version from members where id = $1", [ANANYA]);
      await changePoints(db, admin, ANANYA, { mode: "adjust", delta: 1, expectedVersion: rows[0].version });
    }
    const results = await Promise.allSettled(
      [1, 1, 1].map(() => changePoints(db, admin, ANANYA, { mode: "adjust", delta: 1, expectedVersion: 6 })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { rows } = await db.query<{ score: number }>("select score from members where id = $1", [ANANYA]);
    expect(rows[0].score).toBe(6);
    expect(await listAdjustments(db, { memberId: ANANYA })).toHaveLength(6);
  });

  it("requires confirmation for large changes and resets", async () => {
    await expectHttpError(changePoints(db, admin, ANGAD, { mode: "adjust", delta: 10, expectedVersion: 1 }), 409, "CONFIRMATION_REQUIRED");
    await expectHttpError(changePoints(db, admin, ANGAD, { mode: "set", score: 0, expectedVersion: 1 }), 409, "CONFIRMATION_REQUIRED");
    const { adjustment } = await changePoints(db, admin, ANGAD, { mode: "set", score: 0, expectedVersion: 1, confirmed: true });
    expect(adjustment.kind).toBe("reset");
  });

  it("keeps the score and audit log consistent if the audit insert fails", async () => {
    // A reason over the DB limit makes the audit insert fail after the score update.
    await expect(
      changePoints(db, admin, ANGAD, { mode: "adjust", delta: 1, reason: "x".repeat(600), expectedVersion: 1 }),
    ).rejects.toThrow();
    const { rows } = await db.query<{ score: number; version: number }>("select score, version from members where id = $1", [ANGAD]);
    expect(rows[0]).toEqual({ score: 7, version: 1 });
  });

  it("audit records are append-only", async () => {
    await changePoints(db, admin, ANGAD, { mode: "adjust", delta: 1, expectedVersion: 1 });
    await expect(db.query("update point_adjustments set delta = 100")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from point_adjustments")).rejects.toThrow(/append-only/);
  });

  it("deactivated members keep their data but leave the public ranking", async () => {
    await updateMember(db, admin, ANGAD, { status: "inactive", expectedVersion: 1 });
    const board = await getPublicLeaderboard(db);
    expect(board.members.find((m) => m.id === ANGAD)).toBeUndefined();
    expect(board.totals).toEqual({ activeMembers: 51, totalPoints: 48 });
    const { rows } = await db.query<{ score: number; legacy_history: number[] }>(
      "select score, legacy_history from members where id = $1",
      [ANGAD],
    );
    expect(rows[0]).toEqual({ score: 7, legacy_history: [1, 1, 1, 1, 1, 1, 1] });

    const back = await updateMember(db, admin, ANGAD, { status: "active", expectedVersion: 2 });
    expect(back.status).toBe("active");
  });

  it("creates and renames members, rejecting duplicate names", async () => {
    const created = await createMember(db, admin, { name: "New Member", initialScore: 3 });
    expect(created).toMatchObject({ name: "New Member", score: 3, status: "active", version: 1 });
    expect(created.id).toMatch(/^\d{13}[0-9a-z]{9}$/);
    await expectHttpError(createMember(db, admin, { name: "angad anantula", initialScore: 0 }), 409, "DUPLICATE_NAME");
    const renamed = await updateMember(db, admin, created.id, { name: "Renamed Member", expectedVersion: 1 });
    expect(renamed.name).toBe("Renamed Member");
  });
});

describe("ranking", () => {
  it("uses competition ranking for ties", () => {
    const ranked = rankMembers([
      { id: "a", name: "Zed", score: 7 },
      { id: "b", name: "Amy", score: 7 },
      { id: "c", name: "Bob", score: 3 },
      { id: "d", name: "Cat", score: 0 },
    ]);
    expect(ranked.map((r) => [r.name, r.rank])).toEqual([
      ["Amy", 1],
      ["Zed", 1],
      ["Bob", 3],
      ["Cat", 4],
    ]);
  });
});
