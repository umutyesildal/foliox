/**
 * workers/userSnapshot.ts — per-wallet equity curve snapshotter (V0.2 social).
 *
 * Every ~5 minutes it folds every live user_position against the latest
 * nav_snapshots.share_price and upserts one user_value_snapshots row per
 * wallet (minute-bucketed ts keeps the (wallet, ts) PK stable within the
 * same run). The leaderboard's 7d/30d windows and profile equity curves
 * read from this table. Same discipline as the NAV engine: env-gated start,
 * exact NUMERIC math in Postgres (never JS-number products), honest errors,
 * never signs anything.
 */
import type { PgLike } from "../db/client.js";

export const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * ONE statement per tick: aggregate positions × latest share price in
 * Postgres, bucket ts to the minute, upsert on (wallet, ts). BIGINT/NUMERIC
 * bind as strings per the integer-safety convention; here everything stays
 * inside Postgres NUMERIC — no JS arithmetic at all.
 */
export const USER_SNAPSHOT_SQL = `
  INSERT INTO user_value_snapshots (wallet, ts, value_usd, cost_basis)
  SELECT up."user",
         date_trunc('minute', NOW()),
         SUM(up.share_balance * sp.share_price),
         SUM(up.cost_basis)
  FROM user_positions up
  JOIN LATERAL (
    SELECT share_price FROM nav_snapshots WHERE basket = up.basket ORDER BY ts DESC LIMIT 1
  ) sp ON true
  WHERE up.share_balance > 0
  GROUP BY up."user", date_trunc('minute', NOW())
  ON CONFLICT (wallet, ts) DO UPDATE
    SET value_usd = EXCLUDED.value_usd,
        cost_basis = EXCLUDED.cost_basis`;

export interface UserSnapshotter {
  start: () => void;
  stop: () => void;
  isRunning: boolean;
  /** Run one snapshot tick immediately (used by tests + first-start warmup). */
  tick: () => Promise<number>;
}

export function createUserSnapshotter(db: PgLike | null, intervalMs = DEFAULT_INTERVAL_MS): UserSnapshotter | null {
  if (!db) {
    console.warn("[userSnapshot] disabled (no Postgres)");
    return null;
  }
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let ticking = false;

  const tick = async (): Promise<number> => {
    if (ticking) return 0; // never overlap ticks
    ticking = true;
    try {
      const res = await db.query(USER_SNAPSHOT_SQL, []);
      const rows = res.rowCount ?? 0;
      console.log(`[userSnapshot] upserted ${rows} wallet snapshot(s)`);
      return rows;
    } catch (err) {
      console.error("[userSnapshot] tick failed:", err instanceof Error ? err.message : err);
      return 0;
    } finally {
      ticking = false;
    }
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      void tick(); // warmup tick, then the loop
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
      console.log(`[userSnapshot] started (every ${Math.round(intervalMs / 1000)}s)`);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
      running = false;
    },
    get isRunning() {
      return running;
    },
    tick,
  };
}

export function createUserSnapshotterFromEnv(db: PgLike | null): UserSnapshotter | null {
  const raw = process.env.USER_SNAPSHOT_INTERVAL_MS;
  const interval = raw ? Number(raw) : DEFAULT_INTERVAL_MS;
  return createUserSnapshotter(db, Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_INTERVAL_MS);
}
