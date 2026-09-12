/**
 * indexer/listener.ts — read-only event indexer for the three Basalt programs.
 *
 * Polls `getSignaturesForAddress` per program ID (env: PROGRAM_WHITELIST,
 * PROGRAM_FACTORY, PROGRAM_BASKET), fetches each transaction, decodes the four
 * Anchor CPI events (BasketCreated / Minted / Redeemed / FeeAccrued) from
 * `Program data:` logs via the sha256("event:<Name>") discriminator matcher in
 * ./events.ts, and upserts them into the `events` table — plus a full
 * `baskets` row when a BasketCreated event carries a decodable
 * `create_basket` instruction.
 *
 * SAFETY: this module is strictly read-only against RPC (AGENTS.md §2 #5).
 * It never signs, never holds keys, and never blocks on-chain flows: when
 * Postgres or RPC are absent it degrades to null-DB / no-op polling.
 *
 * INTEGER-SAFETY CONVENTION: u64 fields ride inside `data` JSONB and the
 * baskets upsert as decimal STRINGS (see ./events.ts). `nonce` is bound to a
 * BIGINT column from a string parameter — never a JS number.
 */
import { Connection, PublicKey, type AccountInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { connectFromEnv, isPgLike, type PgLike } from "../db/client.js";
import { syncIndexedBaskets } from "./holdingsSync.js";
import {
  decodeAnchorEvent,
  decodeCreateBasketIx,
  decodeFactoryTreasury,
  extractProgramDataLogs,
  matchAnchorEvent,
  type CreateBasketArgs,
  type DecodedFolioxEvent,
  type FolioxEventType,
} from "./events.js";
import { applyPositionEvent } from "./positions.js";
import { syncPositionsFromChain, type JsonRpcInvoker, type PositionsSyncRpc } from "./positionsSync.js";
import { syncWhitelistedMints, type WhitelistRpc } from "./whitelistSync.js";
import { withRpcBackoff } from "../rpc/backoff.js";

/** Minimal structural slice of @solana/web3.js Connection used here. */
export interface SolanaRpc {
  getSignaturesForAddress(
    address: PublicKey,
    options?: { limit?: number; before?: string; until?: string },
  ): Promise<Array<{ signature: string; slot: number; err: unknown; blockTime?: number | null }>>;
  getParsedTransaction(
    signature: string,
    config?: { maxSupportedTransactionVersion?: number },
  ): Promise<ParsedTransactionWithMeta | null>;
  getAccountInfo(address: PublicKey): Promise<AccountInfo<Buffer> | null>;
}

/**
 * Structural slice for the periodic on-chain state syncs (whitelisted_mints +
 * vault_holdings). A real web3 Connection satisfies it; hand-rolled test RPCs
 * may omit these methods — the syncs no-op when they are missing.
 */
export interface ChainStateRpc extends SolanaRpc {
  getProgramAccounts: WhitelistRpc["getProgramAccounts"];
  getMultipleAccountsInfo(
    keys: PublicKey[],
    commitment?: unknown,
  ): Promise<Array<AccountInfo<Buffer> | null>>;
}

export interface IndexerConfig {
  programIds: string[];
  pollIntervalMs: number;
  signaturesPerPoll: number;
  maxSeenCache: number;
  /**
   * PROGRAM_WHITELIST — enables the periodic on-chain WhitelistedMint →
   * whitelisted_mints sync (price_source labels for the NAV engine).
   */
  whitelistProgramId?: string;
  /** PROGRAM_BASKET — enables the periodic vault_holdings refresh pass. */
  basketProgramId?: string;
  /**
   * vault_holdings refresh cadence override (env HOLDINGS_SYNC_INTERVAL_MS on
   * the devnet profile; schema §7 default stays 30s). Lower request pressure
   * against the shared public RPC without changing the default profile.
   */
  holdingsSyncIntervalMs?: number;
  /**
   * Chain-truth user_positions reconciliation cadence (env POSITIONS_SYNC_MS,
   * default 120s). Reads each indexed basket's share-mint token accounts via
   * getProgramAccounts and upserts user_positions from ACTUAL balances — the
   * durable fix for Minted/Redeemed events lost to log truncation on
   * N-constituent baskets.
   */
  positionsSyncIntervalMs?: number;
  /**
   * Raw JSON-RPC invoker used ONLY as the positions-sync provider fallback
   * (enhanced getTokenAccounts when the provider blocks token-program gPA).
   * Wired from RPC_URL by createIndexerFromEnv; tests may inject their own.
   */
  jsonRpcInvoke?: JsonRpcInvoker;
  /**
   * Minimum spacing between sequential RPC reads inside the periodic state
   * syncs — spreads a mint-facts batch over time instead of bursting it
   * (bursty sequential reads were the main 429 trigger on public devnet).
   */
  stateSyncSpacingMs?: number;
  /**
   * Injectable sleep for the shared 429 backoff (tests: instant). Defaults to
   * the real timer — production waits exponential-with-jitter, 60s cap.
   */
  backoffSleep?: (ms: number) => Promise<void>;
}

/** WhitelistedMint account sync cadence (schema §7: whitelist is slow-moving). */
const WHITELIST_SYNC_INTERVAL_MS = 60_000;
/** vault_holdings refresh cadence (schema §7: "updated every 30s or on event"). */
const HOLDINGS_SYNC_INTERVAL_MS = 30_000;
/**
 * Chain-truth user_positions reconciliation cadence (env POSITIONS_SYNC_MS).
 * 120s: positions drift rarely, each pass costs one getProgramAccounts per
 * indexed basket, and devnet RPC headroom is scarce.
 */
const POSITIONS_SYNC_INTERVAL_MS = 120_000;
/**
 * Spacing between sequential RPC reads in the periodic state syncs (the
 * holdings pass reads mint facts one getAccountInfo at a time — spacing turns
 * that burst into a gentle stream, which is what public devnet 429s on).
 */
const STATE_SYNC_SPACING_MS = 100;
/** Failed signatures are retried this many polls before being dropped. */
const MAX_PROCESS_ATTEMPTS = 5;

export const DEFAULT_INDEXER_CONFIG: IndexerConfig = {
  programIds: [],
  pollIntervalMs: 15_000,
  signaturesPerPoll: 50,
  maxSeenCache: 10_000,
  holdingsSyncIntervalMs: HOLDINGS_SYNC_INTERVAL_MS,
  positionsSyncIntervalMs: POSITIONS_SYNC_INTERVAL_MS,
  stateSyncSpacingMs: STATE_SYNC_SPACING_MS,
};

export interface EventRow {
  sig: string;
  slot: number;
  basket: string | null;
  type: FolioxEventType;
  /** Decoded event; u64 values are decimal strings (BIGINT-safe JSONB). */
  data: Record<string, unknown>;
  ts: Date;
}

export interface BasketUpsert {
  pubkey: string;
  factory: string;
  creator: string;
  treasury: string;
  shareMint: string;
  /** u64 as decimal string — bound to BIGINT via string parameter. */
  nonce: string;
  createdAt: Date;
  metadataHash: string;
  numConstituents: number;
  constituents: string[];
  weightsBps: number[];
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  lastFeeAccrualTs: Date;
}

export interface PollResult {
  programId: string;
  signaturesSeen: number;
  events: DecodedFolioxEvent[];
}

// --- DB writers (no-op with a warn when db is null — DB-less degrade) -------

/** Insert one event row. Returns true only when the row was newly inserted. */
export async function insertEvent(db: PgLike | null | undefined, row: EventRow): Promise<boolean> {
  if (!isPgLike(db)) {
    console.warn("[indexer] insertEvent skipped (no DB):", row.sig, row.type);
    return false;
  }
  const res = await db.query(
    `INSERT INTO events (sig, slot, basket, type, data, ts)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sig) DO NOTHING`,
    [row.sig, row.slot, row.basket, row.type, JSON.stringify(row.data), row.ts],
  );
  return res.rowCount === 1;
}

/** Bulk helper — number of rows actually inserted. */
export async function insertEvents(db: PgLike | null | undefined, rows: EventRow[]): Promise<number> {
  let inserted = 0;
  for (const row of rows) if (await insertEvent(db, row)) inserted++;
  return inserted;
}

/**
 * Upsert the immutable `baskets` row from a BasketCreated event + decoded
 * create_basket args. Baskets never change, so ON CONFLICT DO NOTHING.
 */
export async function upsertBasketFromCreation(
  db: PgLike | null | undefined,
  basket: BasketUpsert,
): Promise<boolean> {
  if (!isPgLike(db)) {
    console.warn("[indexer] upsertBasket skipped (no DB):", basket.pubkey);
    return false;
  }
  const res = await db.query(
    `INSERT INTO baskets (
       pubkey, factory, creator, treasury, share_mint, nonce, created_at,
       metadata_hash, num_constituents, constituents, weights_bps,
       entry_fee_bps, exit_fee_bps, management_fee_bps, last_fee_accrual_ts
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (pubkey) DO NOTHING`,
    [
      basket.pubkey,
      basket.factory,
      basket.creator,
      basket.treasury,
      basket.shareMint,
      basket.nonce, // string → BIGINT (integer-safe)
      basket.createdAt,
      basket.metadataHash,
      basket.numConstituents,
      basket.constituents,
      basket.weightsBps,
      basket.entryFeeBps,
      basket.exitFeeBps,
      basket.managementFeeBps,
      basket.lastFeeAccrualTs,
    ],
  );
  return res.rowCount === 1;
}

/** Count a new basket for the creator (spec §9 creator_stats.basket_count). */
export async function incrementCreatorStats(db: PgLike | null | undefined, creator: string): Promise<void> {
  if (!isPgLike(db)) return; // silent: stats are optional in DB-less mode
  await db.query(
    `INSERT INTO creator_stats (creator, basket_count)
     VALUES ($1, 1)
     ON CONFLICT (creator) DO UPDATE
       SET basket_count = creator_stats.basket_count + 1, updated_at = NOW()`,
    [creator],
  );
}

// --- indexer ----------------------------------------------------------------

function buildBasketUpsert(
  event: Extract<DecodedFolioxEvent, { type: "BasketCreated" }>,
  factory: string,
  args: CreateBasketArgs,
  treasury: string,
): BasketUpsert {
  const createdAt = new Date(event.ts * 1000);
  return {
    pubkey: event.basket,
    factory,
    creator: event.creator,
    treasury,
    shareMint: event.shareMint,
    nonce: args.nonce,
    createdAt,
    metadataHash: args.metadataHashHex,
    numConstituents: event.numConstituents,
    constituents: args.constituents,
    weightsBps: args.weightsBps,
    entryFeeBps: args.entryFeeBps,
    exitFeeBps: args.exitFeeBps,
    managementFeeBps: args.managementFeeBps,
    lastFeeAccrualTs: createdAt,
  };
}

export class EventIndexer {
  private readonly seen = new Set<string>();
  /** Per-signature processing attempts (failed sigs are retried, not dropped). */
  private readonly attempts = new Map<string, number>();
  private lastWhitelistSyncMs = 0;
  private lastHoldingsSyncMs = 0;
  private lastPositionsSyncMs = 0;
  /**
   * Events NOT indexed because their transaction failed on-chain — either at
   * the signature level (getSignaturesForAddress err) or in the fetched meta
   * (tx.meta.err, the partial-CPI-logs case). A reverted tx must never mint
   * Minted/Redeemed/FeeAccrued/BasketCreated rows out of its leftover logs.
   */
  private failedTxSkips = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly rpc: SolanaRpc,
    private readonly cfg: IndexerConfig,
    private readonly db: PgLike | null = null,
  ) {}

  /** Mark a signature processed, bounding the in-memory cache. */
  private markSeen(sig: string): void {
    this.seen.add(sig);
    if (this.seen.size > this.cfg.maxSeenCache) {
      const it = this.seen.values();
      for (let i = 0; i < this.cfg.maxSeenCache / 2; i++) {
        const oldest = it.next().value;
        if (oldest === undefined) break;
        this.seen.delete(oldest);
      }
    }
  }

  /**
   * One poll pass across all configured programs. Decoded events are returned
   * so callers can inspect them even in DB-less mode (db === null). After the
   * signature sweep, the periodic on-chain state syncs run (whitelisted_mints
   * from WhitelistedMint accounts, vault_holdings for indexed baskets).
   */
  async pollOnce(): Promise<PollResult[]> {
    const results: PollResult[] = [];
    for (const programId of this.cfg.programIds) {
      results.push(await this.pollProgram(programId));
    }
    await this.syncChainState();
    return results;
  }

  /**
   * Periodic (throttled) sync of account state that events alone cannot carry:
   *   1. whitelisted_mints ← on-chain WhitelistedMint accounts (price_source).
   *   2. vault_holdings ← basket PDA vault ATAs for every indexed basket.
   *   3. user_positions ← share-mint token accounts for every indexed basket
   *      (chain-truth reconciliation; heals balances whose Minted/Redeemed
   *      events were lost to log truncation).
   * Whitelist rows land BEFORE holdings rows because vault_holdings.mint carries
   * a FK to whitelisted_mints. Every failure is contained — a broken sync never
   * breaks the event poll loop.
   */
  private async syncChainState(): Promise<void> {
    if (!isPgLike(this.db)) return;
    const full = this.rpc as ChainStateRpc;
    if (typeof full.getProgramAccounts !== "function") return; // hand-rolled test rpc
    const now = Date.now();
    const spacing = this.cfg.stateSyncSpacingMs ?? STATE_SYNC_SPACING_MS;
    if (this.cfg.whitelistProgramId && now - this.lastWhitelistSyncMs >= WHITELIST_SYNC_INTERVAL_MS) {
      this.lastWhitelistSyncMs = now;
      try {
        const n = await syncWhitelistedMints(full, this.cfg.whitelistProgramId, this.db);
        if (n > 0) console.log(`[indexer] whitelist sync: ${n} mints upserted`);
      } catch (err) {
        console.warn("[indexer] whitelist sync failed:", err instanceof Error ? err.message : err);
      }
    }
    const holdingsIntervalMs = this.cfg.holdingsSyncIntervalMs ?? HOLDINGS_SYNC_INTERVAL_MS;
    if (now - this.lastHoldingsSyncMs >= holdingsIntervalMs) {
      this.lastHoldingsSyncMs = now;
      try {
        const n = await syncIndexedBaskets(full, this.db, { spacingMs: spacing });
        if (n > 0) console.log(`[indexer] holdings sync: ${n} baskets refreshed`);
      } catch (err) {
        console.warn("[indexer] holdings sync failed:", err instanceof Error ? err.message : err);
      }
    }
    const positionsIntervalMs = this.cfg.positionsSyncIntervalMs ?? POSITIONS_SYNC_INTERVAL_MS;
    if (now - this.lastPositionsSyncMs >= positionsIntervalMs) {
      this.lastPositionsSyncMs = now;
      try {
        // Structural cast: the real Connection (and the test doubles that opt
        // in) carries getProgramAccounts; hand-rolled test RPCs without it are
        // filtered out above.
        const stats = await syncPositionsFromChain(
          full as unknown as PositionsSyncRpc,
          this.db,
          { spacingMs: spacing, backoffSleep: this.cfg.backoffSleep, jsonRpcInvoke: this.cfg.jsonRpcInvoke },
        );
        if (stats.basketsScanned > 0) {
          console.log(
            `[indexer] positions sync: ${stats.holders} holders across ${stats.basketsScanned} baskets ` +
              `(${stats.eventKept} event-derived, ${stats.balanceSynced} balance-sync, ${stats.zeroed} zeroed` +
              `${stats.basketsFailed > 0 ? `, ${stats.basketsFailed} baskets failed (retry next tick)` : ""})`,
          );
        }
      } catch (err) {
        console.warn("[indexer] positions sync failed:", err instanceof Error ? err.message : err);
      }
    }
  }

  private async pollProgram(programId: string): Promise<PollResult> {
    const events: DecodedFolioxEvent[] = [];
    let signaturesSeen = 0;
    let sigInfos;
    try {
      // The shared backoff is the ONLY retry layer: when this batch already
      // went through 429 backoff and still failed, the catch below logs and
      // returns — it never re-fires the batch (no double-fire).
      sigInfos = await withRpcBackoff(
        () =>
          this.rpc.getSignaturesForAddress(new PublicKey(programId), {
            limit: this.cfg.signaturesPerPoll,
          }),
        { logKey: "indexer:getSignaturesForAddress", sleep: this.cfg.backoffSleep },
      );
    } catch (err) {
      console.warn(`[indexer] getSignaturesForAddress failed for ${programId}:`, err instanceof Error ? err.message : err);
      return { programId, signaturesSeen, events };
    }

    // getSignaturesForAddress returns NEWEST-first; process OLDEST-first so a
    // fresh sync lands the BasketCreated tx (which upserts the baskets row)
    // before the Minted/Redeemed/FeeAccrued txs whose rows FK-reference it.
    for (const sigInfo of [...sigInfos].reverse()) {
      if (sigInfo.err) {
        // ERR GUARD (layer 1): a transaction that failed on-chain must never
        // contribute events — count and skip; the chain-truth positions sync
        // is what keeps user_positions aligned regardless.
        this.failedTxSkips++;
        continue;
      }
      if (this.seen.has(sigInfo.signature)) continue;
      signaturesSeen++;
      try {
        const tx = await withRpcBackoff(
          () =>
            this.rpc.getParsedTransaction(sigInfo.signature, {
              maxSupportedTransactionVersion: 0,
            }),
          { logKey: "indexer:getParsedTransaction", sleep: this.cfg.backoffSleep },
        );
        if (!tx?.meta?.logMessages) {
          this.markSeen(sigInfo.signature);
          continue;
        }
        if (tx.meta.err) {
          // ERR GUARD (layer 2): the fetched transaction itself reports a
          // on-chain failure (meta.err). Its logs may still contain partial
          // CPI output (fees accrued before the revert), but NONE of it may
          // become Minted/Redeemed/FeeAccrued/BasketCreated rows. Log + count
          // + skip; the positions sync reconciles balances from chain truth.
          this.failedTxSkips++;
          console.warn(
            `[indexer] skipping failed tx ${sigInfo.signature} (meta.err set) — ` +
              `no events indexed from failed transactions (skipped so far: ${this.failedTxSkips})`,
          );
          this.markSeen(sigInfo.signature);
          continue;
        }
        const programKey = new PublicKey(programId);
        const rows: EventRow[] = [];
        // Events decoded from THIS transaction only (for the positions sync).
        const txEvents: DecodedFolioxEvent[] = [];
        let basketCreated: Extract<DecodedFolioxEvent, { type: "BasketCreated" }> | null = null;
        let createArgs: CreateBasketArgs | null = null;

        for (const payload of extractProgramDataLogs(tx.meta.logMessages)) {
          const type = matchAnchorEvent(payload);
          if (!type) continue;
          const event = decodeAnchorEvent(type, payload);
          if (!event) continue;
          events.push(event);
          txEvents.push(event);
          const tsSec = sigInfo.blockTime ?? (event.type === "BasketCreated" ? event.ts : Math.floor(Date.now() / 1000));
          const data: Record<string, unknown> = { ...event, programId };
          if (event.type === "BasketCreated") {
            basketCreated = event;
            // Enrich from the create_basket instruction in the same tx.
            createArgs = await this.decodeCreateBasketFromTx(tx, programId);
            if (createArgs) data.createBasket = createArgs;
          }
          rows.push({
            sig: sigInfo.signature,
            slot: sigInfo.slot,
            basket: event.basket,
            type,
            data,
            ts: new Date(tsSec * 1000),
          });
        }

        if (rows.length > 0) {
          // BasketCreated must upsert the baskets row BEFORE the event rows:
          // events.basket carries a FK to baskets(pubkey), so on a fresh sync
          // the create tx would otherwise fail its own event insert. The
          // upsert is idempotent (ON CONFLICT DO NOTHING); creator_stats below
          // stays gated on the event insert being fresh AND the basket row
          // being newly created, so replays never double-count.
          let basketUpserted = false;
          if (
            basketCreated &&
            createArgs &&
            createArgs.constituents.length === basketCreated.numConstituents
          ) {
            const factory = await this.resolveFactory(tx, programId);
            if (factory) {
              const treasury = await this.fetchTreasury(factory);
              if (treasury) {
                const upsert = buildBasketUpsert(basketCreated, factory, createArgs, treasury);
                basketUpserted = await upsertBasketFromCreation(this.db, upsert);
              } else {
                console.warn(`[indexer] could not decode FactoryConfig treasury for basket ${basketCreated.basket}`);
              }
            }
          }
          // Only persist downstream rows when the event insert is fresh, so
          // re-processing a signature can never double-count creator_stats.
          let fresh = false;
          for (const row of rows) fresh = (await insertEvent(this.db, row)) || fresh;
          if (fresh && basketCreated && basketUpserted) {
            await incrementCreatorStats(this.db, basketCreated.creator);
          }
        }

        // user_positions sync — AFTER the core upserts. The position_events
        // (sig, kind) ledger makes each write idempotent on its own, so this
        // runs even when the events row insert above was not fresh (recovery
        // after a crash between the two writes). Degrades to a warn when db
        // is null; per-event failures never break the poll loop.
        for (const ev of txEvents) {
          try {
            await applyPositionEvent(this.db, sigInfo.signature, ev);
          } catch (err) {
            console.warn(
              `[indexer] user_positions sync failed for ${sigInfo.signature} (${ev.type}):`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      } catch (err) {
        // Do NOT drop the signature on failure: devnet RPC 429s and FK waits
        // on a basket row an older signature will establish both heal on
        // retry. Track attempts and give up only after MAX_PROCESS_ATTEMPTS.
        const attempt = (this.attempts.get(sigInfo.signature) ?? 0) + 1;
        this.attempts.set(sigInfo.signature, attempt);
        if (attempt >= MAX_PROCESS_ATTEMPTS) {
          console.warn(
            `[indexer] giving up on ${sigInfo.signature} after ${attempt} attempts:`,
            err instanceof Error ? err.message : err,
          );
          this.markSeen(sigInfo.signature);
          this.attempts.delete(sigInfo.signature);
        } else {
          console.warn(
            `[indexer] failed to process ${sigInfo.signature} (attempt ${attempt}/${MAX_PROCESS_ATTEMPTS}, will retry):`,
            err instanceof Error ? err.message : err,
          );
        }
        continue; // leave unseen so the next poll retries it
      }
      this.markSeen(sigInfo.signature);
      this.attempts.delete(sigInfo.signature);
    }
    return { programId, signaturesSeen, events };
  }

  /** Find the create_basket ix for this program and decode its base58 args. */
  private async decodeCreateBasketFromTx(
    tx: ParsedTransactionWithMeta,
    programId: string,
  ): Promise<CreateBasketArgs | null> {
    const all = [
      ...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions),
    ];
    for (const ix of all) {
      const pid = ix.programId?.toBase58?.();
      if (pid !== programId) continue;
      const data = (ix as { data?: unknown }).data;
      if (typeof data !== "string") continue;
      const args = decodeCreateBasketIx(data);
      if (args) return args;
    }
    return null;
  }

  /** FactoryConfig PDA = first account of the create_basket instruction. */
  private async resolveFactory(tx: ParsedTransactionWithMeta, programId: string): Promise<string | null> {
    const all = [
      ...tx.transaction.message.instructions,
      ...(tx.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions),
    ];
    for (const ix of all) {
      if (ix.programId?.toBase58?.() !== programId) continue;
      const data = (ix as { data?: unknown }).data;
      if (typeof data !== "string") continue;
      if (!decodeCreateBasketIx(data)) continue;
      const accounts = (ix as { accounts?: readonly PublicKey[] }).accounts;
      return accounts?.[0]?.toBase58() ?? null;
    }
    return null;
  }

  private async fetchTreasury(factory: string): Promise<string | null> {
    try {
      const info = await withRpcBackoff(
        () => this.rpc.getAccountInfo(new PublicKey(factory)),
        { logKey: "indexer:getAccountInfo", sleep: this.cfg.backoffSleep },
      );
      return decodeFactoryTreasury(info?.data ?? null);
    } catch {
      return null;
    }
  }

  /** Long-running poll loop. Idempotent; call stop() to end it. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    const loop = async (): Promise<void> => {
      if (this.stopped) {
        this.running = false;
        return;
      }
      try {
        await this.pollOnce();
      } catch (err) {
        console.warn("[indexer] poll failed:", err instanceof Error ? err.message : err);
      }
      if (!this.stopped) {
        this.timer = setTimeout(() => void loop(), this.cfg.pollIntervalMs);
        this.timer.unref?.();
      } else {
        this.running = false;
      }
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Events skipped because their transaction failed on-chain (err guard). */
  get failedTxSkipCount(): number {
    return this.failedTxSkips;
  }
}

// --- env wiring -------------------------------------------------------------

export function indexerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): (IndexerConfig & { rpcUrl: string }) | null {
  const rpcUrl = env.RPC_URL;
  if (!rpcUrl) return null;
  const programIds = [env.PROGRAM_WHITELIST, env.PROGRAM_FACTORY, env.PROGRAM_BASKET]
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (programIds.length === 0) return null;
  return {
    rpcUrl,
    programIds,
    whitelistProgramId: env.PROGRAM_WHITELIST,
    basketProgramId: env.PROGRAM_BASKET,
    pollIntervalMs: Number(env.INDEXER_POLL_MS || DEFAULT_INDEXER_CONFIG.pollIntervalMs),
    signaturesPerPoll: Number(env.INDEXER_POLL_LIMIT || DEFAULT_INDEXER_CONFIG.signaturesPerPoll),
    maxSeenCache: DEFAULT_INDEXER_CONFIG.maxSeenCache,
    holdingsSyncIntervalMs: Number(env.HOLDINGS_SYNC_INTERVAL_MS || HOLDINGS_SYNC_INTERVAL_MS),
    positionsSyncIntervalMs: Number(env.POSITIONS_SYNC_MS || POSITIONS_SYNC_INTERVAL_MS),
    stateSyncSpacingMs: DEFAULT_INDEXER_CONFIG.stateSyncSpacingMs,
  };
}

/**
 * Build an indexer from env, or null when RPC_URL / program IDs are missing
 * (DB-less and RPC-less environments degrade honestly to null).
 */
export async function createIndexerFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<EventIndexer | null> {
  const cfg = indexerConfigFromEnv(env);
  if (!cfg) {
    console.warn("[indexer] RPC_URL or PROGRAM_* env missing — indexer disabled");
    return null;
  }
  const db = await connectFromEnv();
  // Raw JSON-RPC invoker (read-only POST) for the positions-sync provider
  // fallback: web3.js Connection has no custom-method surface, and some
  // providers block token-program getProgramAccounts while offering an
  // enhanced getTokenAccounts instead.
  const jsonRpcInvoke: JsonRpcInvoker = async (method, params) => {
    const res = await fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`jsonrpc ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(`jsonrpc ${method} failed: ${body.error.message}`);
    return body.result;
  };
  return new EventIndexer(new Connection(cfg.rpcUrl), { ...cfg, jsonRpcInvoke }, db);
}
