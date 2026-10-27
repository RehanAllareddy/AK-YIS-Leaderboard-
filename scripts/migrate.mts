import { runMigrations } from "../src/lib/db/migrate.ts";
import { openDb } from "./env.mts";

const db = await openDb();
try {
  const applied = await runMigrations(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await db.close();
}
