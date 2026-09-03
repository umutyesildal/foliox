/**
 * indexer/listener.ts — read-only event indexer for the three FolioX programs.
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

export interface IndexerConfig {
  programIds: string[];
  pollIntervalMs: number;
  signaturesPerPoll: number;
  maxSeenCache: number;
}

export const DEFAULT_INDEXER_CONFIG: IndexerConfig = {
  programIds: [],
  pollIntervalMs: 15_000,
  signaturesPerPoll: 50,
  maxSeenCache: 10_000,
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
   * so callers can inspect them even in DB-less mode (db === null).
   */
  async pollOnce(): Promise<PollResult[]> {
    const results: PollResult[] = [];
    for (const programId of this.cfg.programIds) {
      results.push(await this.pollProgram(programId));
    }
    return results;
  }

  private async pollProgram(programId: string): Promise<PollResult> {
    const events: DecodedFolioxEvent[] = [];
    let signaturesSeen = 0;
    let sigInfos;
    try {
      sigInfos = await this.rpc.getSignaturesForAddress(new PublicKey(programId), {
        limit: this.cfg.signaturesPerPoll,
      });
    } catch (err) {
      console.warn(`[indexer] getSignaturesForAddress failed for ${programId}:`, err instanceof Error ? err.message : err);
      return { programId, signaturesSeen, events };
    }

    for (const sigInfo of sigInfos) {
      if (sigInfo.err) continue; // failed txs emit nothing we care about
      if (this.seen.has(sigInfo.signature)) continue;
      signaturesSeen++;
      try {
        const tx = await this.rpc.getParsedTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx?.meta?.logMessages) {
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
          // Only persist downstream rows when the event insert is fresh, so
          // re-processing a signature can never double-count creator_stats.
          let fresh = false;
          for (const row of rows) fresh = (await insertEvent(this.db, row)) || fresh;
          if (
            fresh &&
            basketCreated &&
            createArgs &&
            createArgs.constituents.length === basketCreated.numConstituents
          ) {
            const factory = await this.resolveFactory(tx, programId);
            if (factory) {
              const treasury = await this.fetchTreasury(factory);
              if (treasury) {
                const upsert = buildBasketUpsert(basketCreated, factory, createArgs, treasury);
                if (await upsertBasketFromCreation(this.db, upsert)) {
                  await incrementCreatorStats(this.db, basketCreated.creator);
                }
              } else {
                console.warn(`[indexer] could not decode FactoryConfig treasury for basket ${basketCreated.basket}`);
              }
            }
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
        console.warn(`[indexer] failed to process ${sigInfo.signature}:`, err instanceof Error ? err.message : err);
      } finally {
        this.markSeen(sigInfo.signature);
      }
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
      const info = await this.rpc.getAccountInfo(new PublicKey(factory));
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
    pollIntervalMs: Number(env.INDEXER_POLL_MS || DEFAULT_INDEXER_CONFIG.pollIntervalMs),
    signaturesPerPoll: Number(env.INDEXER_POLL_LIMIT || DEFAULT_INDEXER_CONFIG.signaturesPerPoll),
    maxSeenCache: DEFAULT_INDEXER_CONFIG.maxSeenCache,
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
  return new EventIndexer(new Connection(cfg.rpcUrl), cfg, db);
}
