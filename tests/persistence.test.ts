import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { importLeaderboard } from "@/lib/import/leaderboard";
import { changePoints, getPublicLeaderboard } from "@/lib/server/members";
import { createAdmin, readDataFile } from "./helpers";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "akyis-persist-"));
const dataDir = path.join(dir, "db");

describe("persistence", () => {
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("keeps admin changes and audit history across restarts", async () => {
    const first = await createDb(`pglite:${dataDir}`);
    await runMigrations(first);
    await importLeaderboard(first, readDataFile(), { source: "test" });
    const admin = await createAdmin(first);
    await changePoints(first, admin, "1791226468231lp2p4x6my", { mode: "adjust", delta: 4, reason: "Pitch", expectedVersion: 1 });
    await first.close();

    // "Restart": new connection to the same on-disk database.
    const second = await createDb(`pglite:${dataDir}`);
    expect(await runMigrations(second)).toEqual([]); // migrations don't re-run
    const board = await getPublicLeaderboard(second);
    expect(board.members.find((m) => m.name === "Ananya Sinha")?.score).toBe(4);
    expect(board.totals.totalPoints).toBe(59);
    const { rows } = await second.query<{ n: number }>("select count(*)::int as n from point_adjustments");
    expect(rows[0].n).toBe(1);
    // Re-running the import after a restart still doesn't clobber the change.
    const rerun = await importLeaderboard(second, readDataFile(), { source: "test" });
    expect(rerun.imported).toBe(0);
    expect((await getPublicLeaderboard(second)).totals.totalPoints).toBe(59);
    await second.close();
  });

  it("refuses to open a local database already in use by another process", async () => {
    const lockDir = path.join(dir, "locked");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(`${lockDir}.lock`, String(process.ppid));
    await expect(createDb(`pglite:${lockDir}`)).rejects.toThrow(/in use by another process/);
  });
});
