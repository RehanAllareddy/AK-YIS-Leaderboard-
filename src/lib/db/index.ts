import "server-only";
import { createDb, type Db } from "./client";
import { runMigrations } from "./migrate";

export type { Db, Queryable } from "./client";

const globalForDb = globalThis as unknown as { __akyisDb?: Promise<Db> };

/** Returns the process-wide database handle (survives dev hot reloads). */
export function getDb(): Promise<Db> {
  if (!globalForDb.__akyisDb) {
    globalForDb.__akyisDb = connect().catch((error) => {
      globalForDb.__akyisDb = undefined;
      throw error;
    });
  }
  return globalForDb.__akyisDb;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and configure it.");
  }
  const db = await createDb(url);
  // The embedded local database migrates itself for convenience. Real
  // Postgres deployments are migrated explicitly with `npm run db:migrate`.
  if (db.kind === "pglite") await runMigrations(db);
  return db;
}

/** Test hook: point the app at a specific database. */
export function setDbForTesting(db: Db | undefined) {
  globalForDb.__akyisDb = db ? Promise.resolve(db) : undefined;
}
