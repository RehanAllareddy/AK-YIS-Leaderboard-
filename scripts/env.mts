import fs from "node:fs";
import { createDb, type Db } from "../src/lib/db/client.ts";

/** Loads .env.local / .env (if present) and opens the configured database. */
export async function openDb(): Promise<Db> {
  for (const file of [".env.local", ".env"]) {
    if (fs.existsSync(file)) process.loadEnvFile(file);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and configure it.");
    process.exit(1);
  }
  return createDb(url);
}
