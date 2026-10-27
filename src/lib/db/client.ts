import fs from "node:fs";
import path from "node:path";

/**
 * Minimal database interface shared by the production Postgres driver (`pg`)
 * and the embedded PGlite engine used for local development and tests.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs one or more statements without parameters (used for migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: "postgres" | "pglite";
}

/**
 * DATABASE_URL formats:
 *   postgres://user:pass@host:port/db   — any PostgreSQL server (e.g. Supabase)
 *   pglite:./.data/pglite               — embedded Postgres stored on disk (local dev)
 *   pglite:memory                       — embedded, in memory (tests)
 */
export async function createDb(url: string): Promise<Db> {
  if (url.startsWith("pglite:")) {
    return createPgliteDb(url.slice("pglite:".length));
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return createPostgresDb(url);
  }
  throw new Error("DATABASE_URL must start with postgres://, postgresql:// or pglite:");
}

async function createPostgresDb(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const parsed = new URL(url);
  const sslMode = parsed.searchParams.get("sslmode");
  // We configure TLS explicitly below, so drop libpq-style params pg would
  // otherwise reinterpret.
  parsed.searchParams.delete("sslmode");
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");

  let ssl: false | { rejectUnauthorized: boolean; ca?: string };
  if (sslMode === "disable" || (isLocal && !ca && sslMode !== "require")) {
    ssl = false;
  } else if (ca) {
    ssl = { rejectUnauthorized: true, ca };
  } else {
    // Encrypted, but without CA pinning. Set DATABASE_CA_CERT to verify the
    // server certificate (recommended; see README).
    ssl = { rejectUnauthorized: false };
  }

  const pool = new Pool({
    connectionString: parsed.toString(),
    ssl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return {
    kind: "postgres",
    async query(sql, params) {
      const result = await pool.query(sql, params as unknown[] | undefined);
      return { rows: result.rows };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const tx: Queryable = {
          async query(sql, params) {
            const result = await client.query(sql, params as unknown[] | undefined);
            return { rows: result.rows };
          },
          async exec(sql) {
            await client.query(sql);
          },
        };
        const value = await fn(tx);
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPgliteDb(location: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const inMemory = location === "" || location === "memory";
  let releaseLock = () => {};
  let dataDir: string | undefined;
  if (!inMemory) {
    dataDir = path.resolve(location);
    fs.mkdirSync(dataDir, { recursive: true });
    releaseLock = acquireLock(dataDir);
  }
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  // PGlite is single-connection; serialise transactions so concurrent
  // requests in the dev server cannot interleave statements.
  let queue: Promise<unknown> = Promise.resolve();

  const db: Db = {
    kind: "pglite",
    async query(sql, params) {
      await queue;
      const result = await pg.query(sql, params);
      return { rows: result.rows as never[] };
    },
    async exec(sql) {
      await queue;
      await pg.exec(sql);
    },
    transaction(fn) {
      const run = queue.then(() =>
        pg.transaction(async (t) =>
          fn({
            async query(sql, params) {
              const result = await t.query(sql, params);
              return { rows: result.rows as never[] };
            },
            async exec(sql) {
              await t.exec(sql);
            },
          }),
        ),
      );
      queue = run.catch(() => {});
      return run;
    },
    async close() {
      await queue;
      await pg.close();
      releaseLock();
    },
  };
  return db;
}

/**
 * PGlite stores data in a directory that only one process may open at a
 * time. Guard against e.g. running the import script while `next dev` is
 * using the same directory, which would corrupt it.
 */
function acquireLock(dataDir: string): () => void {
  const lockFile = path.join(path.dirname(dataDir), `${path.basename(dataDir)}.lock`);
  try {
    const existing = Number(fs.readFileSync(lockFile, "utf8"));
    if (existing && existing !== process.pid && isAlive(existing)) {
      throw new Error(
        `The local database at ${dataDir} is in use by another process (pid ${existing}). ` +
          "Stop the dev server before running database scripts.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  fs.writeFileSync(lockFile, String(process.pid));
  return () => {
    try {
      if (Number(fs.readFileSync(lockFile, "utf8")) === process.pid) fs.unlinkSync(lockFile);
    } catch {
      // already gone
    }
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
