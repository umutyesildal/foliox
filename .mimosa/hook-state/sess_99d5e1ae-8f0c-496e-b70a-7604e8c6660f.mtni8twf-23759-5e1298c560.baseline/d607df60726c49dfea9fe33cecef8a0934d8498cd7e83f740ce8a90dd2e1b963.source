/**
 * db/client.ts — minimal duck-typed PostgreSQL surface + env guard.
 *
 * DEGRADATION CONTRACT (Wave B hard rule): every DB-writing function in the
 * indexer/holdings-sync path takes a `PgLike | null` client parameter. When
 * Postgres is absent the caller passes `null` and the function skips writes
 * while still returning decoded/typed data — the backend stays honest and
 * runnable without a database (AGENTS.md §9: "indexer convenience only").
 *
 * `connectFromEnv()` returns null instead of throwing when DATABASE_URL is
 * unset, so workers can simply do:
 *     const db = await connectFromEnv();
 *     await upsertEvents(db, rows); // no-op when db === null
 */
import type { Pool as PgPool, PoolClient, Client as PgClient, QueryResult } from "pg";

/** Any pg Pool / PoolClient / Client (or test double) that can run queries. */
export interface PgLike {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
}

export function isPgLike(value: unknown): value is PgLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { query?: unknown }).query === "function"
  );
}

let cachedClient: PgLike | null = null;

/**
 * Build (and memoize) a pg client from DATABASE_URL.
 * Returns null (never throws) when DATABASE_URL is unset or pg is missing —
 * callers must treat null as "DB-less mode, skip persistence".
 */
export async function connectFromEnv(databaseUrl?: string): Promise<PgLike | null> {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    console.warn("[db] DATABASE_URL not set — running without Postgres persistence");
    return null;
  }
  if (cachedClient) return cachedClient;
  try {
    // Dynamic import keeps pg out of the module graph in DB-less environments.
    const pg = (await import("pg")) as typeof import("pg");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    console.log("[db] connected to Postgres");
    cachedClient = client as unknown as PgLike;
    return cachedClient;
  } catch (err) {
    console.warn("[db] Postgres connection failed — continuing without persistence:", errorMessage(err));
    return null;
  }
}

/** Close the memoized env client, if any (used by tests and shutdown). */
export async function disconnectFromEnv(): Promise<void> {
  const client = cachedClient;
  cachedClient = null;
  if (client && typeof (client as { end?: unknown }).end === "function") {
    await (client as unknown as { end: () => Promise<void> }).end();
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Re-exported for typing convenience at call sites that hold real pg handles.
export type { PgPool, PoolClient, PgClient, QueryResult };
