/**
 * Usage: npm run db:import -- [file] [--dry-run] [--overwrite]
 *   file         defaults to data/leaderboard_2026-10-27.json
 *   --dry-run    validate and report without writing anything
 *   --overwrite  replace members whose database values differ from the file
 *                (by default the database copy wins, so admin changes made
 *                after the first import are never clobbered)
 */
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "../src/lib/db/migrate.ts";
import { formatSummary, importLeaderboard, LeaderboardFileError } from "../src/lib/import/leaderboard.ts";
import { openDb } from "./env.mts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const overwrite = args.includes("--overwrite");
const file = args.find((a) => !a.startsWith("--")) ?? "data/leaderboard_2026-10-27.json";

if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}
const contents = fs.readFileSync(file, "utf8");

const db = await openDb();
try {
  await runMigrations(db);
  const summary = await importLeaderboard(db, contents, { source: path.basename(file), dryRun, overwrite });
  console.log(formatSummary(summary));
  if (summary.rejected > 0) process.exitCode = 2;
} catch (error) {
  if (error instanceof LeaderboardFileError) {
    console.error(`Import aborted: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await db.close();
}
