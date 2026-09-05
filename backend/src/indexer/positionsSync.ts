/**
 * indexer/positionsSync.ts — periodic CHAIN-TRUTH reconciliation for
 * user_positions (the durable fix for lost Minted/Redeemed events).
 *
 * WHY: the event listener derives balances from Anchor CPI logs, and on
 * N-constituent baskets (6+) the transaction logs get truncated by the RPC —
 * `Program data:` event lines disappear, so Minted/Redeemed events are missed
 * while the shares DO exist on-chain (the user sees them client-side). Events
 * are an approximation; the share-mint token accounts are the truth. This pass
 * makes the backend converge on the chain no matter what the log parser saw:
 *
 *   for every indexed basket:
 *     1. read ALL Token-2022 token accounts whose mint == basket.share_mint
 *        (one getProgramAccounts call per basket with a memcmp filter on the
 *        mint field — per-basket calls are the pagination unit; no
 *        dataSize filter because Token-2022 extension accounts exceed 165
 *        bytes and must not be dropped),
 *     2. upsert user_positions from ACTUAL balances:
 *          - a Minted/Redeemed events row exists for (user, basket) →
 *            reconcile share_balance only; cost_basis + cost_basis_source
 *            keep their event-derived values;
 *          - balances exist but NO such events row (the truncation case) →
 *            upsert with cost_basis_source = 'balance-sync' (honest
 *            provenance; cost_basis stays untouched/NULL — backfilled by the
 *            normal applyMinted path if the event surfaces later);
 *          - DB row whose token account is gone (deleted/closed) or holds 0 →
 *            row deleted (history remains in position_events).
 *
 * CONSISTENCY MODEL: this pass is the reconciler of last resort and runs every
 * POSITIONS_SYNC_MS; event-driven writes (indexer/positions.ts) remain the
 * low-latency path and the only cost-basis source. If an event applies after a
 * sync pass already wrote the chain balance, balances can transiently drift —
 * the next pass re-reads the chain and corrects them. share_balance is ALWAYS
 * converged to chain truth; cost_basis is ONLY ever written by events.
 *
 * RPC LOAD: one holder read per indexed basket per pass, every call through
 * the shared withRpcBackoff pacer and spaced with the 100ms state-sync
 * convention (createPacer) — the same gentle shape as the whitelist/holdings
 * syncs, no new 429 storm.
 *
 * PROVIDER FALLBACK: the primary read is getProgramAccounts on Token-2022
 * with a mint memcmp filter (canonical shape). Some providers (notably
 * api.devnet.solana.com / Triton) EXCLUDE the token programs from their gPA
 * secondary indexes ("-32010 … excluded from account secondary indexes"); for
 * exactly that error the pass falls back to the provider's enhanced
 * `getTokenAccounts(null, <mint>, …)` JSON-RPC method, which enumerates ALL
 * holders of a mint. Any other failure (429s after backoff, timeouts) is
 * contained per-basket and retried next tick — never a fallback storm.
 *
 * SAFETY: strictly read-only against RPC (AGENTS.md §2 #5). A failing basket
 * scan is contained (warn + skip) so a partial pass never zero-outs positions
 * of baskets it could not read — those retry on the next tick.
 */
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { isPgLike, type PgLike } from "../db/client.js";
import { withRpcBackoff, createPacer } from "../rpc/backoff.js";

/** Structural slice of @solana/web3.js Connection used here. */
export interface PositionsSyncRpc {
  getProgramAccounts(
    programId: PublicKey,
    config?: {
      encoding?: string;
      filters?: Array<{ memcmp?: { offset: number; bytes: string }; dataSize?: number }>;
      commitment?: unknown;
    },
  ): Promise<Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>>;
}

/** Raw JSON-RPC invoker for provider-enhanced methods (wired from env RPC_URL). */
export type JsonRpcInvoker = (method: string, params: unknown[]) => Promise<unknown>;

/**
 * True when the error is a provider refusing token-program getProgramAccounts
 * (secondary-index exclusion) — the ONE error class with a documented
 * alternative; everything else (429s, timeouts) just retries next tick.
 */
export function isTokenIndexExcludedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /excluded from account secondary indexes|this RPC method unavailable for key/i.test(msg);
}

export interface ChainHolder {
  /** Token account owner (the user) as base58. */
  user: string;
  /** Share mint as base58. */
  mint: string;
  /** On-chain u64 amount as a decimal string (BIGINT-safe binding). */
  amount: string;
}

/** One reconciled (user, basket) row outcome, for logging/tests. */
export interface PositionsSyncStats {
  /** Baskets whose token accounts were read successfully this pass. */
  basketsScanned: number;
  /** Baskets skipped (RPC failure) — their DB rows are left untouched. */
  basketsFailed: number;
  /** Distinct (user, basket) rows found on-chain with a positive balance. */
  holders: number;
  /** Rows reconciled while preserving event-derived cost basis. */
  eventKept: number;
  /** Rows created/updated with cost_basis_source = 'balance-sync'. */
  balanceSynced: number;
  /** Rows deleted because the on-chain account is gone or holds zero. */
  zeroed: number;
}

// --- token account parsing (pure, fixture-testable) ---------------------------

/**
 * Parse (owner, amount) out of a raw SPL token / Token-2022 account buffer.
 * Layout (identical for legacy Token and Token-2022): mint[0..32],
 * owner[32..64], amount u64 LE [64..72]. Returns null for short/malformed
 * buffers — never invents a position.
 */
export function parseTokenAccountOwnerAmount(data: Buffer): { owner: string; amount: bigint } | null {
  if (!data || data.length < 72) return null;
  try {
    const owner = new PublicKey(data.subarray(32, 64)).toBase58();
    const amount = data.readBigUInt64LE(64);
    return { owner, amount };
  } catch {
    return null;
  }
}

/**
 * All holders of one share mint: decode + aggregate per owner (an owner may
 * hold several token accounts; chain truth is the SUM). Unreadable accounts
 * are skipped with a warn. Zero-balance accounts are returned as holders too
 * (the caller decides zero-out vs skip) — no, they are dropped here: a
 * zero-amount account is indistinguishable from "no position" for the holders
 * count, and the zero-out branch is driven by DB rows missing from this map.
 */
export function parseShareHolders(
  accounts: Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>,
  expectedMint: PublicKey | string,
): ChainHolder[] {
  const totals = new Map<string, bigint>();
  for (const { pubkey, account } of accounts) {
    const parsed = parseTokenAccountOwnerAmount(account?.data);
    if (!parsed) {
      console.warn(`[positionsSync] undecodable token account ${pubkey?.toBase58() ?? "?"} — skipped`);
      continue;
    }
    if (parsed.amount === 0n) continue; // zero balance == no live position
    totals.set(parsed.owner, (totals.get(parsed.owner) ?? 0n) + parsed.amount);
  }
  const mint = new PublicKey(expectedMint).toBase58();
  return [...totals.entries()].map(([user, amount]) => ({ user, mint, amount: amount.toString() }));
}

// --- static SQL (every dynamic value is a bound parameter) --------------------

const LOAD_BASKETS_SQL = `SELECT pubkey, share_mint FROM baskets`;

const LOAD_POSITIONS_SQL = `SELECT "user", basket FROM user_positions`;

/** Distinct users with an indexed Minted/Redeemed event for this basket. */
const EVENT_EVIDENCE_SQL = `SELECT DISTINCT data->>'user' AS user FROM events
 WHERE basket = $1 AND type IN ('Minted','Redeemed') AND data->>'user' = ANY($2)`;

/** Event-derived row: reconcile the balance, keep cost_basis + provenance. */
const UPDATE_KEEP_EVENT_SQL = `UPDATE user_positions
 SET share_balance = $3, updated_at = NOW()
 WHERE "user" = $1 AND basket = $2`;

/** Fresh row for a wallet that DOES have indexed events (cost basis pending
 *  — the normal applyMinted path owns cost_basis, not the balance sync). */
const INSERT_EVENT_PENDING_SQL = `INSERT INTO user_positions ("user", basket, share_balance, cost_basis, cost_basis_source, updated_at)
 VALUES ($1, $2, $3, NULL, NULL, NOW())
 ON CONFLICT ("user", basket) DO NOTHING`;

/** Balance-sync provenance: keeps any existing cost_basis, honest source. */
const UPDATE_BALANCE_SYNC_SQL = `UPDATE user_positions
 SET share_balance = $3, cost_basis_source = 'balance-sync', updated_at = NOW()
 WHERE "user" = $1 AND basket = $2`;

/** Fresh row for the truncation case: balances exist, no events ever indexed. */
const INSERT_BALANCE_SYNC_SQL = `INSERT INTO user_positions ("user", basket, share_balance, cost_basis, cost_basis_source, updated_at)
 VALUES ($1, $2, $3, NULL, 'balance-sync', NOW())
 ON CONFLICT ("user", basket) DO UPDATE
   SET share_balance = EXCLUDED.share_balance,
       cost_basis_source = 'balance-sync',
       updated_at = NOW()`;

/** Zero-out: the on-chain token account is deleted/closed or drained to 0. */
const ZERO_OUT_SQL = `DELETE FROM user_positions WHERE basket = $1 AND "user" = ANY($2)`;

// --- the reconciliation pass ---------------------------------------------------

/**
 * Read every token account of `shareMint` via getProgramAccounts on Token-2022
 * (memcmp filter on the mint field — offset 0 of a token account), through the
 * shared 429 backoff. The mint filter alone; NO dataSize filter so extended
 * Token-2022 accounts (>165 bytes) are never dropped.
 *
 * When the provider refuses token-program gPA (secondary-index exclusion —
 * e.g. api.devnet.solana.com) AND a `jsonRpcInvoke` is wired, falls back to
 * the provider-enhanced getTokenAccounts(null, <mint>) enumeration. Any other
 * error propagates (the per-basket catch contains it; retried next tick).
 */
export async function fetchShareHolders(
  rpc: PositionsSyncRpc,
  shareMint: PublicKey | string,
  opts: { backoffSleep?: (ms: number) => Promise<void>; jsonRpcInvoke?: JsonRpcInvoker } = {},
): Promise<ChainHolder[]> {
  const mint = new PublicKey(shareMint);
  try {
    const accounts = await withRpcBackoff(
      () =>
        rpc.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
          encoding: "base64",
          filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
        }),
      { logKey: "positionsSync:getProgramAccounts", sleep: opts.backoffSleep },
    );
    return parseShareHolders(accounts, mint);
  } catch (err) {
    if (!opts.jsonRpcInvoke || !isTokenIndexExcludedError(err)) throw err;
    console.warn(
      `[positionsSync] provider blocks token-program getProgramAccounts — ` +
        `falling back to enhanced getTokenAccounts for mint ${mint.toBase58()}`,
    );
    return fetchShareHoldersViaTokenApi(opts.jsonRpcInvoke, mint);
  }
}

/** One parsed entry of the enhanced getTokenAccounts response. */
export interface TokenApiAccount {
  address?: string;
  mint?: string;
  /** u64 — arrives as a JSON number from the provider (see precision note). */
  amount?: number | string;
  owner?: string;
}

/**
 * Provider-enhanced holder enumeration: getTokenAccounts(null, <mint>, …)
 * returns EVERY token account of a mint (owner + amount pre-parsed). Uses the
 * raw JSON-RPC invoker (web3.js Connection has no custom-method surface).
 * PRECISION NOTE: providers serialize the u64 `amount` as a JSON number; for
 * values beyond 2^53 the gPA path (raw account bytes) stays authoritative —
 * this fallback is the devnet-reality path where supplies are small.
 */
export async function fetchShareHoldersViaTokenApi(
  invoke: JsonRpcInvoker,
  mint: string | PublicKey,
): Promise<ChainHolder[]> {
  const mintKey = new PublicKey(mint).toBase58();
  const res = (await withRpcBackoff(
    () =>
      invoke("getTokenAccounts", [null, mintKey, null, null, null, null, null, null]) as Promise<{
        total?: number;
        limit?: number;
        token_accounts?: TokenApiAccount[];
      }>,
    { logKey: "positionsSync:getTokenAccounts" },
  )) as { total?: number; limit?: number; token_accounts?: TokenApiAccount[] };

  const accounts = res.token_accounts ?? [];
  const totals = new Map<string, bigint>();
  for (const a of accounts) {
    if (typeof a.owner !== "string" || a.amount === undefined || a.amount === null) continue;
    const amount = BigInt(a.amount); // number or string — BigInt() accepts both exactly
    if (amount === 0n) continue;
    totals.set(a.owner, (totals.get(a.owner) ?? 0n) + amount);
  }
  if (typeof res.total === "number" && res.total > accounts.length) {
    console.warn(
      `[positionsSync] getTokenAccounts returned ${accounts.length}/${res.total} accounts for ${mintKey} — ` +
        `result may be incomplete this pass (limit ${res.limit ?? "?"})`,
    );
  }
  return [...totals.entries()].map(([user, amount]) => ({ user, mint: mintKey, amount: amount.toString() }));
}

/**
 * One reconciliation pass over every indexed basket. Per-basket failures are
 * contained: the basket is counted in basketsFailed, its DB rows are left
 * untouched, and the next tick retries it. Returns per-outcome counters for
 * logging/tests.
 */
export async function syncPositionsFromChain(
  rpc: PositionsSyncRpc,
  db: PgLike | null | undefined,
  opts: { spacingMs?: number; backoffSleep?: (ms: number) => Promise<void>; jsonRpcInvoke?: JsonRpcInvoker } = {},
): Promise<PositionsSyncStats> {
  const stats: PositionsSyncStats = {
    basketsScanned: 0,
    basketsFailed: 0,
    holders: 0,
    eventKept: 0,
    balanceSynced: 0,
    zeroed: 0,
  };
  if (!isPgLike(db)) {
    console.warn("[positionsSync] skipped (no DB)");
    return stats;
  }

  const basketsRes = await db.query(LOAD_BASKETS_SQL);
  const baskets = basketsRes.rows as Array<{ pubkey: string; share_mint: string }>;

  const posRes = await db.query(LOAD_POSITIONS_SQL);
  const dbRows = posRes.rows as Array<{ user: string; basket: string }>;
  const dbKeys = new Set(dbRows.map((r) => `${r.user}|${r.basket}`));

  // Minimum spacing between sequential getProgramAccounts calls — a pass over
  // many baskets must stream, not burst (same convention as the holdings sync).
  const pacer = createPacer(opts.spacingMs ?? 0);

  for (const b of baskets) {
    let holders: ChainHolder[];
    try {
      await pacer.wait();
      holders = await fetchShareHolders(rpc, new PublicKey(b.share_mint), {
        backoffSleep: opts.backoffSleep,
        jsonRpcInvoke: opts.jsonRpcInvoke,
      });
    } catch (err) {
      stats.basketsFailed++;
      console.warn(`[positionsSync] share holders read failed for basket ${b.pubkey} — retrying next tick:`,
        err instanceof Error ? err.message : err);
      continue; // contained: DB rows for this basket stay untouched
    }
    stats.basketsScanned++;

    const usersOnChain = holders.map((h) => h.user);
    const amounts = new Map(holders.map((h) => [h.user, h.amount]));

    // Which of these users have event-derived evidence (Minted/Redeemed)?
    let usersWithEvents = new Set<string>();
    if (usersOnChain.length > 0) {
      try {
        const evRes = await db.query(EVENT_EVIDENCE_SQL, [b.pubkey, usersOnChain]);
        usersWithEvents = new Set(
          (evRes.rows as Array<{ user: string | null }>).map((r) => r.user).filter((u): u is string => typeof u === "string"),
        );
      } catch (err) {
        // Evidence lookup failed: treat as NO evidence → 'balance-sync' is the
        // honest (conservative) provenance; events keep their own write path.
        console.warn(`[positionsSync] event evidence lookup failed for basket ${b.pubkey}:`,
          err instanceof Error ? err.message : err);
      }
    }

    for (const user of usersOnChain) {
      const amount = amounts.get(user)!; // positive by construction
      const exists = dbKeys.has(`${user}|${b.pubkey}`);
      const hasEvents = usersWithEvents.has(user);
      if (hasEvents && exists) {
        await db.query(UPDATE_KEEP_EVENT_SQL, [user, b.pubkey, amount]);
        stats.eventKept++;
      } else if (hasEvents && !exists) {
        await db.query(INSERT_EVENT_PENDING_SQL, [user, b.pubkey, amount]);
        stats.eventKept++;
      } else if (!hasEvents && exists) {
        await db.query(UPDATE_BALANCE_SYNC_SQL, [user, b.pubkey, amount]);
        stats.balanceSynced++;
      } else {
        await db.query(INSERT_BALANCE_SYNC_SQL, [user, b.pubkey, amount]);
        stats.balanceSynced++;
      }
      dbKeys.add(`${user}|${b.pubkey}`);
    }
    stats.holders += usersOnChain.length;

    // Zero-out: DB rows for THIS (successfully scanned) basket whose token
    // account disappeared or drained to zero. History stays in position_events.
    const gone = dbRows
      .filter((r) => r.basket === b.pubkey && !amounts.has(r.user))
      .map((r) => r.user);
    if (gone.length > 0) {
      await db.query(ZERO_OUT_SQL, [b.pubkey, gone]);
      stats.zeroed += gone.length;
      for (const user of gone) dbKeys.delete(`${user}|${b.pubkey}`);
    }
  }

  return stats;
}
