/**
 * index.ts — FolioX backend entrypoint (PORT=3001).
 *
 * Env-gated subsystem startup, every subsystem logs enabled/disabled:
 *   * Postgres   — DATABASE_URL          → applySchema (db/init.ts)
 *   * Indexer    — RPC_URL + PROGRAM_*   → createIndexerFromEnv().start()
 *   * NAV engine — DATABASE_URL (opt-out NAV_ENGINE=0) → snapshot loop + rankings refresh
 *   * Fee crank  — DATABASE_URL (opt-out FEE_CRANK=0; RPC for blockhashes) → hourly
 *                  UNSIGNED accrue_management_fee tx builder (never signs — AGENTS §2 #5)
 *   * Cache      — REDIS_URL → Redis, else in-memory TTL map (nav:{basket}, quote:*)
 *   * API        — always up, even with zero env (DB routes then answer 503
 *                  DB_UNAVAILABLE and subsystems report disabled — nothing is
 *                  ever fabricated).
 */
import http from "http";
import { connectFromEnv, disconnectFromEnv } from "./db/client.js";
import { applySchema } from "./db/init.js";
import { createIndexerFromEnv } from "./indexer/listener.js";
import { createNavEngineFromEnv, createCacheFromEnv, type KeyValueCache } from "./workers/navEngine.js";
import { createFeeCrankFromEnv } from "./workers/feeCrank.js";
import { createUserSnapshotterFromEnv } from "./workers/userSnapshot.js";
import { createHandler, API_VERSION, type SubsystemStatus } from "./api/server.js";

const PORT = Number(process.env.PORT || 3001);

async function main(): Promise<void> {
  console.log(`FolioX backend v${API_VERSION} starting (port ${PORT})`);

  // 1. Postgres + normative spec §7 schema (both degrade honestly when unset).
  const db = await connectFromEnv();
  let schemaApplied: boolean | null = null;
  if (db) {
    try {
      schemaApplied = await applySchema(db);
    } catch (err) {
      schemaApplied = false;
      console.warn("[db] schema bootstrap failed:", err instanceof Error ? err.message : err);
    }
  }

  // 2. Shared cache: Redis when REDIS_URL is set, else in-memory TTL map.
  const cache: KeyValueCache = await createCacheFromEnv();

  // 3. Indexer (read-only event indexer — never signs, AGENTS.md §2 #5).
  const indexer = await createIndexerFromEnv();
  if (indexer) {
    indexer.start();
    console.log("[indexer] enabled (read-only event polling; never signs)");
  }

  // 4. NAV engine — NAV snapshots + basket_rankings refresh + nav:{basket} cache.
  const navEngine = createNavEngineFromEnv({ db, cache });
  if (navEngine) navEngine.start();

  // 5. Fee crank — hourly UNSIGNED accrue_management_fee txs for keepers.
  const feeCrank = createFeeCrankFromEnv({ db });
  if (feeCrank) feeCrank.start();

  // 5b. User snapshotter — per-wallet equity curve for profiles + leaderboard.
  const userSnapshotter = createUserSnapshotterFromEnv(db);
  if (userSnapshotter) userSnapshotter.start();

  // 6. API — always listening.
  const status = (): SubsystemStatus => ({
    db: { connected: db !== null, schemaApplied },
    indexer: { enabled: indexer !== null, running: indexer?.isRunning ?? false },
    navEngine: { enabled: navEngine !== null, running: navEngine?.isRunning ?? false },
    feeCrank: { enabled: feeCrank !== null, running: feeCrank?.isRunning ?? false },
    userSnapshot: { enabled: userSnapshotter !== null, running: userSnapshotter?.isRunning ?? false },
  });
  const server = http.createServer(createHandler({ db, cache, status }));
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`FolioX backend listening on :${PORT}`);
  console.log(` - GET  /api/v1/baskets            (basket_rankings, source: onchain-indexed)`);
  console.log(` - GET  /api/v1/baskets/:pubkey    (detail + NAV + holdings + drift)`);
  console.log(` - GET  /api/v1/baskets/:pubkey/holdings | /nav/history | /performance`);
 console.log(` - GET  /api/v1/whitelist | /creators/:p | /users/:p/portfolio | /health`);
 console.log(` - GET  /api/v1/positions?wallet=:p  (chain-reconciled user positions + NAV price)`);
 console.log(` - POST /api/v1/quotes/zap-in|zap-out (Jupiter quote legs — quotes only, backend never signs)`);
 console.log(` - GET  /api/v1/feed | /leaderboard | /users/:w/profile|history   (social — on-chain verified)`);
 console.log(` - POST /api/v1/auth/nonce|verify   (wallet-signature auth for SOCIAL WRITES only)`);
 console.log(
   ` subsystems: db=${db ? "on" : "off"} indexer=${indexer ? "on" : "off"} ` +
     `navEngine=${navEngine ? "on" : "off"} feeCrank=${feeCrank ? "on" : "off"} ` +
     `userSnapshot=${userSnapshotter ? "on" : "off"} ` +
     `cache=${process.env.REDIS_URL ? "redis" : "in-memory"}`,
 );

  // Graceful shutdown — stop loops, close server, close DB.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received — stopping subsystems`);
  indexer?.stop();
  navEngine?.stop();
  feeCrank?.stop();
  userSnapshotter?.stop();
    server.close(() => {
      void disconnectFromEnv().finally(() => process.exit(0));
    });
    // Hard exit if connections refuse to drain.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[boot] fatal:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
