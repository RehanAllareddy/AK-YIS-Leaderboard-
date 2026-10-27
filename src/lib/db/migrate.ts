import fs from "node:fs";
import path from "node:path";
import type { Db } from "./client";

/** Applies any SQL files in db/migrations that have not run yet, in name order. */
export async function runMigrations(db: Db): Promise<string[]> {
  await db.exec(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
    alter table schema_migrations enable row level security;
  `);
  const { rows } = await db.query<{ name: string }>("select name from schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  // Paths are written out literally so the bundler can trace exactly these files.
  const files = fs
    .readdirSync(path.join(process.cwd(), "db", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(process.cwd(), "db", "migrations", file), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into schema_migrations (name) values ($1)", [file]);
    });
    newlyApplied.push(file);
  }
  return newlyApplied;
}
