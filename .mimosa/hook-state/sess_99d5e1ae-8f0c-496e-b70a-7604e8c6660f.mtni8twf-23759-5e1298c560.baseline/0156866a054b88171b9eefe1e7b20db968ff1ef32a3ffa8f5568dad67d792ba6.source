/**
 * db/init.ts — applies the normative spec §7 schema (schema.sql) on boot.
 *
 * Degradation contract: `applySchema(db)` takes any PgLike (pg Client, Pool,
 * PoolClient). `ensureSchemaFromEnv()` guards on DATABASE_URL and never
 * throws — callers log the boolean and keep running DB-less when false.
 *
 * The SQL file is loaded from disk so `psql -f src/db/schema.sql` and this
 * module always execute the same statements. Candidate paths cover running
 * from the repo root (tsx backend/src/...), from backend/, and from the
 * compiled dist/ output (build copies schema.sql next to the compiled js).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPgLike, type PgLike } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Candidate locations for schema.sql, in priority order. */
export function schemaCandidates(): string[] {
  return [
    resolve(here, "schema.sql"), // src/db (tsx) or dist/db (build copies it)
    resolve(process.cwd(), "backend/src/db/schema.sql"), // repo-root cwd
    resolve(process.cwd(), "src/db/schema.sql"), // backend/ cwd
    resolve(process.cwd(), "db/schema.sql"),
  ];
}

/** Load and return the schema SQL, or null when the file cannot be found. */
export function loadSchemaSql(): string | null {
  for (const candidate of schemaCandidates()) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Execute the whole schema against `db` in one implicit transaction
 * (schema.sql is BEGIN/COMMIT wrapped and fully idempotent).
 * Returns true when the statements ran; false when db is null/invalid or the
 * SQL file is missing — never throws on a null client.
 */
export async function applySchema(db: PgLike | null | undefined): Promise<boolean> {
  if (!isPgLike(db)) {
    console.warn("[db] applySchema skipped: no Postgres client (DB-less mode)");
    return false;
  }
  const sql = loadSchemaSql();
  if (sql === null) {
    console.warn("[db] applySchema skipped: schema.sql not found in", schemaCandidates());
    return false;
  }
  // Simple query protocol (no bind params) supports multi-statement scripts.
  await db.query(sql);
  return true;
}

/**
 * Convenience for boot: connect from DATABASE_URL (null when unset) and apply
 * the schema. Never throws; returns false in any DB-less configuration.
 */
export async function ensureSchemaFromEnv(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.warn("[db] DATABASE_URL not set — skipping schema bootstrap (DB-less mode)");
    return false;
  }
  const { connectFromEnv } = await import("./client.js");
  const db = await connectFromEnv();
  if (!db) return false;
  try {
    return await applySchema(db);
  } catch (err) {
    console.warn("[db] schema bootstrap failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
