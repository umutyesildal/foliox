/**
 * positionsSync.test.ts — chain-truth user_positions reconciliation
 * (indexer/positionsSync.ts), the listener ERR GUARD (failed transactions
 * never contribute events), and the GET /api/v1/positions?wallet= route.
 *
 * No RPC, no real Postgres: token accounts are hand-built 165-byte buffers,
 * the RPC is a fake getProgramAccounts (with a 429 failure mode), and the DB
 * is a stateful fake PgLike that actually mutates a user_positions map so
 * upsert/zero-out semantics are asserted across calls.
 */
import { describe, it, expect } from "vitest";
import http from "http";
import { PublicKey, type AccountInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import type { PgLike } from "../src/db/client";
import { ANCHOR_EVENT_DISCRIMINATORS, type MintedEvent } from "../src/indexer/events";
import { EventIndexer, type SolanaRpc } from "../src/indexer/listener";
import {
  fetchShareHolders,
  parseShareHolders,
  parseTokenAccountOwnerAmount,
  syncPositionsFromChain,
  type PositionsSyncRpc,
} from "../src/indexer/positionsSync";
import { createHandler, userPositionsByWallet } from "../src/api/server";

// --- fixtures ------------------------------------------------------------------

const pk = (n: number) => new PublicKey(Buffer.alloc(32, n));
const BASKET = pk(10).toBase58();
const SHARE_MINT = pk(11).toBase58();
const USER = pk(20).toBase58();
const USER2 = pk(21).toBase58();
const USER3 = pk(22).toBase58();

/** Hand-built SPL token / Token-2022 token account (mint|owner|amount u64 LE). */
function tokenAccount(
  owner: PublicKey | string,
  mint: PublicKey | string,
  amount: bigint,
): { pubkey: PublicKey; account: AccountInfo<Buffer> } {
  const data = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(data, 0);
  new PublicKey(owner).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt8(1, 108); // AccountState::Initialized
  return { pubkey: pk((new PublicKey(owner).toBuffer()[0] + 100) % 250), account: { data, executable: false, owner: TOKEN_2022_PROGRAM_ID, lamports: 1 } };
}

/**
 * Fake RPC: answers getProgramAccounts per the mint in the memcmp filter
 * (mirrors production), with an optional set of mints that always 429 —
 * pass an instant `backoffSleep` so exhausting the shared backoff is free.
 */
function gpaRpcByMint(
  perMint: Record<string, Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>>,
  opts: { failMints?: Set<string> } = {},
): PositionsSyncRpc & { calls: number } {
  const rpc = {
    calls: 0,
    async getProgramAccounts(_pid: PublicKey, cfg?: { filters?: Array<{ memcmp?: { bytes: string } }> }) {
      rpc.calls++;
      const mint = cfg?.filters?.[0]?.memcmp?.bytes ?? "?";
      if (opts.failMints?.has(mint)) throw new Error("429 Too Many Requests");
      return perMint[mint] ?? [];
    },
  };
  return rpc;
}

interface SyncRow {
  user: string;
  basket: string;
  share_balance: string;
  cost_basis: string | null;
  cost_basis_source: string | null;
}

type SyncDb = PgLike & {
  rows: Map<string, SyncRow>;
  calls: Array<{ sql: string; values?: unknown[] }>;
  /** users that have a Minted/Redeemed events row per basket. */
  eventUsers: Map<string, Set<string>>;
};

/**
 * Stateful fake: actually mutates a (user|basket → row) map for the four
 * sync write shapes, and answers the baskets / user_positions / events
 * reads from state.
 */
function syncDb(
  baskets: Array<{ pubkey: string; share_mint: string }>,
  eventUsers: Map<string, Set<string>> = new Map(),
): SyncDb {
  const rows = new Map<string, SyncRow>();
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const key = (u: unknown, b: unknown) => `${u}|${b}`;
  const db = {
    rows,
    calls,
    eventUsers,
    query: async (sql: string, values: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
      calls.push({ sql, values });
      if (sql.includes("FROM baskets")) {
        return { rows: baskets.map((b) => ({ ...b })), rowCount: baskets.length };
      }
      if (sql.includes("FROM events")) {
        const basket = values[0] as string;
        const users = (values[1] as string[]) ?? [];
        const withEvents = eventUsers.get(basket) ?? new Set<string>();
        const hit = users.filter((u) => withEvents.has(u)).map((user) => ({ user }));
        return { rows: hit, rowCount: hit.length };
      }
      if (sql.startsWith("SELECT")) {
        // SELECT "user", basket FROM user_positions
        return { rows: [...rows.values()].map((r) => ({ user: r.user, basket: r.basket })), rowCount: rows.size };
      }
      if (sql.startsWith("UPDATE user_positions") && sql.includes("cost_basis_source = 'balance-sync'")) {
        const row = rows.get(key(values[0], values[1]));
        if (!row) return { rows: [], rowCount: 0 };
        row.share_balance = values[2] as string;
        row.cost_basis_source = "balance-sync"; // cost_basis intentionally untouched
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE user_positions")) {
        const row = rows.get(key(values[0], values[1]));
        if (!row) return { rows: [], rowCount: 0 };
        row.share_balance = values[2] as string; // cost_basis + source kept
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO user_positions")) {
        const balanceSync = sql.includes("'balance-sync'");
        rows.set(key(values[0], values[1]), {
          user: values[0] as string,
          basket: values[1] as string,
          share_balance: values[2] as string,
          cost_basis: null,
          cost_basis_source: balanceSync ? "balance-sync" : null,
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("DELETE FROM user_positions")) {
        const basket = values[0] as string;
        const users = (values[1] as string[]) ?? [];
        let removed = 0;
        for (const u of users) if (rows.delete(key(u, basket))) removed++;
        return { rows: [], rowCount: removed };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return db as unknown as SyncDb;
}

// ============================================================================
// 1. token account parsing (pure)
// ============================================================================

describe("positionsSync — token account parsing", () => {
  it("parses owner + amount from a raw token account buffer", () => {
    const parsed = parseTokenAccountOwnerAmount(tokenAccount(USER, SHARE_MINT, 123456n).account.data);
    expect(parsed).toEqual({ owner: USER, amount: 123456n });
  });

  it("rejects short/malformed buffers (never invents a position)", () => {
    expect(parseTokenAccountOwnerAmount(Buffer.alloc(10))).toBeNull();
    expect(parseTokenAccountOwnerAmount(Buffer.alloc(0))).toBeNull();
  });

  it("parseShareHolders sums multiple accounts per owner and drops zero balances", () => {
    const accounts = [
      tokenAccount(USER, SHARE_MINT, 1000n),
      tokenAccount(USER2, SHARE_MINT, 7n),
      tokenAccount(USER, SHARE_MINT, 500n), // second account, same owner
      tokenAccount(USER3, SHARE_MINT, 0n), // drained → not a holder
    ];
    const holders = parseShareHolders(accounts, SHARE_MINT);
    expect(holders).toHaveLength(2);
    const byUser = new Map(holders.map((h) => [h.user, h.amount]));
    expect(byUser.get(USER)).toBe("1500"); // u64 sum, decimal string
    expect(byUser.get(USER2)).toBe("7");
  });

  it("fetchShareHolders passes the mint memcmp filter through the backoff pacer", async () => {
    const rpc = gpaRpcByMint({ [SHARE_MINT]: [tokenAccount(USER, SHARE_MINT, 42n)] });
    let seenCfg: unknown;
    const spy: PositionsSyncRpc = {
      getProgramAccounts: async (_pid, cfg) => {
        seenCfg = cfg;
        return rpc.getProgramAccounts(_pid, cfg);
      },
    };
    const holders = await fetchShareHolders(spy, SHARE_MINT);
    expect(holders).toEqual([{ user: USER, mint: SHARE_MINT, amount: "42" }]);
    const cfg = seenCfg as { filters: Array<{ memcmp?: { offset: number; bytes: string } }> };
    expect(cfg.filters[0].memcmp).toEqual({ offset: 0, bytes: SHARE_MINT });
  });

  it("provider fallback: gPA secondary-index exclusion → enhanced getTokenAccounts enumeration", async () => {
    const blockedRpc: PositionsSyncRpc = {
      getProgramAccounts: async () => {
        throw new Error(
          "failed to get accounts owned by program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: " +
            "excluded from account secondary indexes; this RPC method unavailable for key",
        );
      },
    };
    const invoked: Array<{ method: string; params: unknown[] }> = [];
    const invoke = async (method: string, params: unknown[]) => {
      invoked.push({ method, params });
      return {
        total: 2,
        limit: 1000,
        token_accounts: [
          { address: "A1", mint: SHARE_MINT, amount: 3860, owner: USER },
          { address: "A2", mint: SHARE_MINT, amount: 140, owner: USER }, // same owner, summed
          { address: "A3", mint: SHARE_MINT, amount: 0, owner: USER3 }, // zero → dropped
        ],
      };
    };
    const holders = await fetchShareHolders(blockedRpc, SHARE_MINT, { jsonRpcInvoke: invoke, backoffSleep: async () => {} });
    expect(invoked.length).toBe(1);
    expect(invoked[0].method).toBe("getTokenAccounts");
    expect(invoked[0].params[0]).toBeNull(); // no owner filter
    expect(invoked[0].params[1]).toBe(SHARE_MINT); // mint filter
    expect(holders).toEqual([{ user: USER, mint: SHARE_MINT, amount: "4000" }]);
  });

  it("no fallback on 429s: a rate-limited gPA propagates after backoff (contained per basket)", async () => {
    let gpaCalls = 0;
    const limitedRpc: PositionsSyncRpc = {
      getProgramAccounts: async () => {
        gpaCalls++;
        throw new Error("429 Too Many Requests");
      },
    };
    let invocations = 0;
    const db = syncDb([{ pubkey: BASKET, share_mint: SHARE_MINT }]);
    const stats = await syncPositionsFromChain(limitedRpc, db, {
      spacingMs: 0,
      backoffSleep: async () => {},
      jsonRpcInvoke: async () => {
        invocations++;
        return {};
      },
    });
    expect(gpaCalls).toBe(3); // 1 initial + 2 backoff retries (the ONE retry layer)
    expect(invocations).toBe(0); // 429s never trigger the provider fallback
    expect(stats.basketsFailed).toBe(1);
    expect(db.rows.size).toBe(0); // failed basket touched nothing
  });
});

// ============================================================================
// 2. syncPositionsFromChain — upsert / keep-event / zero-out / partial failure
// ============================================================================

describe("positionsSync — chain-truth reconciliation", () => {
  it("truncation case: on-chain balance with NO indexed events → 'balance-sync' provenance", async () => {
    const db = syncDb([{ pubkey: BASKET, share_mint: SHARE_MINT }]);
    const rpc = gpaRpcByMint({ [SHARE_MINT]: [tokenAccount(USER, SHARE_MINT, 3860n)] });
    const stats = await syncPositionsFromChain(rpc, db, { spacingMs: 0 });
    expect(stats).toMatchObject({ basketsScanned: 1, holders: 1, balanceSynced: 1, eventKept: 0, zeroed: 0 });
    expect(db.rows.get(`${USER}|${BASKET}`)).toEqual({
      user: USER,
      basket: BASKET,
      share_balance: "3860",
      cost_basis: null, // never fabricated — backfilled if events appear later
      cost_basis_source: "balance-sync",
    });
  });

  it("event-derived case: Minted/Redeemed events exist → balance reconciled, cost_basis + source kept", async () => {
    const db = syncDb([{ pubkey: BASKET, share_mint: SHARE_MINT }]);
    db.rows.set(`${USER}|${BASKET}`, {
      user: USER,
      basket: BASKET,
      share_balance: "999999", // stale event-derived value
      cost_basis: "1403.69898413704",
      cost_basis_source: "reference",
    });
    db.eventUsers.set(BASKET, new Set([USER]));
    const rpc = gpaRpcByMint({ [SHARE_MINT]: [tokenAccount(USER, SHARE_MINT, 3860n)] });
    const stats = await syncPositionsFromChain(rpc, db, { spacingMs: 0 });
    expect(stats).toMatchObject({ holders: 1, eventKept: 1, balanceSynced: 0 });
    expect(db.rows.get(`${USER}|${BASKET}`)).toEqual({
      user: USER,
      basket: BASKET,
      share_balance: "3860", // reconciled to chain truth
      cost_basis: "1403.69898413704", // event-derived value preserved
      cost_basis_source: "reference", // provenance preserved
    });
  });

  it("zero-out: a DB row whose token account is gone is deleted (history stays in position_events)", async () => {
    const db = syncDb([{ pubkey: BASKET, share_mint: SHARE_MINT }]);
    db.rows.set(`${USER}|${BASKET}`, {
      user: USER,
      basket: BASKET,
      share_balance: "1000",
      cost_basis: "100",
      cost_basis_source: "balance-sync",
    });
    const rpc = gpaRpcByMint({}); // account closed on-chain
    const stats = await syncPositionsFromChain(rpc, db, { spacingMs: 0 });
    expect(stats.zeroed).toBe(1);
    expect(db.rows.has(`${USER}|${BASKET}`)).toBe(false);
  });

  it("partial failure: a basket whose gPA 429s is skipped, its DB rows untouched, others still sync", async () => {
    const B2 = pk(12).toBase58();
    const SM2 = pk(13).toBase58();
    const db = syncDb([
      { pubkey: BASKET, share_mint: SHARE_MINT },
      { pubkey: B2, share_mint: SM2 },
    ]);
    db.rows.set(`${USER3}|${BASKET}`, {
      user: USER3,
      basket: BASKET,
      share_balance: "555",
      cost_basis: null,
      cost_basis_source: null,
    });
    const rpc = gpaRpcByMint(
      {
        [SHARE_MINT]: [tokenAccount(USER, SHARE_MINT, 1n)],
        [SM2]: [tokenAccount(USER2, SM2, 2n)],
      },
      { failMints: new Set([SHARE_MINT]) }, // basket 1 429s through all backoff attempts
    );
    const stats = await syncPositionsFromChain(rpc, db, { spacingMs: 0, backoffSleep: async () => {} });
    expect(stats.basketsFailed).toBe(1);
    expect(stats.basketsScanned).toBe(1);
    expect(stats.balanceSynced).toBe(1);
    // failed basket's row untouched (no zero-out from a pass that could not read it)
    expect(db.rows.get(`${USER3}|${BASKET}`)).toMatchObject({ share_balance: "555" });
    // scanned basket reconciled
    expect(db.rows.get(`${USER2}|${B2}`)).toMatchObject({ share_balance: "2", cost_basis_source: "balance-sync" });
  });

  it("null DB degrades honestly (no throw, zero stats)", async () => {
    const rpc = gpaRpcByMint({ [SHARE_MINT]: [tokenAccount(USER, SHARE_MINT, 1n)] });
    const stats = await syncPositionsFromChain(rpc, null);
    expect(stats).toMatchObject({ basketsScanned: 0, holders: 0 });
    expect(rpc.calls).toBe(0); // RPC not even touched without a DB
  });
});

// ============================================================================
// 3. listener ERR GUARD — failed transactions never contribute events
// ============================================================================

describe("listener — err guard (failed txs are never indexed)", () => {
  function u64le(v: bigint): Buffer {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v);
    return b;
  }

  function mintedLogPayload(ev: MintedEvent): Buffer {
    return Buffer.concat([
      ANCHOR_EVENT_DISCRIMINATORS.Minted,
      new PublicKey(ev.basket).toBuffer(),
      new PublicKey(ev.user).toBuffer(),
      u64le(BigInt(ev.grossShares)),
      u64le(BigInt(ev.netShares)),
      u64le(BigInt(ev.entryFeeShares)),
    ]);
  }

  const MINTED: MintedEvent = {
    type: "Minted",
    basket: BASKET,
    user: USER,
    grossShares: "1001000",
    netShares: "1000000",
    entryFeeShares: "1000",
  };

  function fakeTx(logs: string[], err: unknown = null): ParsedTransactionWithMeta {
    return {
      transaction: { message: { instructions: [] } },
      meta: { logMessages: logs, innerInstructions: [], slot: 42, err },
    } as unknown as ParsedTransactionWithMeta;
  }

  function rpcFor(
    sigErr: unknown,
    tx: ParsedTransactionWithMeta,
    fetched: string[] = [],
  ): SolanaRpc {
    return {
      async getSignaturesForAddress() {
        return [{ signature: "FAILED-SIG", slot: 42, err: sigErr, blockTime: 1725148800 }];
      },
      async getParsedTransaction(sig: string) {
        fetched.push(sig);
        return tx;
      },
      async getAccountInfo() {
        return null;
      },
    };
  }

  const CFG = { programIds: [pk(99).toBase58()], pollIntervalMs: 1000, signaturesPerPoll: 10, maxSeenCache: 100 };
  const log = [`Program data: ${mintedLogPayload(MINTED).toString("base64")}`];

  it("meta.err non-null: the Minted log in the tx is NOT indexed — no events, no position, counter increments", async () => {
    const db = syncDb([{ pubkey: BASKET, share_mint: SHARE_MINT }]);
    const fetched: string[] = [];
    const indexer = new EventIndexer(rpcFor(null, fakeTx(log, { InstructionError: [0, "custom"] }), fetched), CFG, db);
    await indexer.pollOnce();
    expect(indexer.failedTxSkipCount).toBe(1);
    expect(fetched).toEqual(["FAILED-SIG"]); // tx WAS fetched (meta-level guard)
    // nothing written: no events row, no position_events claim, no balance
    expect(db.calls.filter((c) => c.sql.includes("INSERT INTO events")).length).toBe(0);
    expect(db.calls.filter((c) => c.sql.includes("INSERT INTO position_events")).length).toBe(0);
    expect(db.rows.size).toBe(0);
  });

  it("sig-level err non-null: counted and skipped, tx never even fetched", async () => {
    const db = syncDb([]);
    const fetched: string[] = [];
    const indexer = new EventIndexer(rpcFor("AccountInUse", fakeTx(log), fetched), CFG, db);
    await indexer.pollOnce();
    expect(indexer.failedTxSkipCount).toBe(1);
    expect(fetched).toEqual([]); // getParsedTransaction never called
    expect(db.calls.filter((c) => c.sql.includes("INSERT INTO events")).length).toBe(0);
  });

  it("healthy tx with meta.err null still indexes normally (guard does not over-skip)", async () => {
    const db = syncDb([{ pubkey: BASKET, share_mint: SHARE_MINT }], new Map([[BASKET, new Set([USER])]]));
    // Seed events + a position so applyMinted has something to blend; the
    // assertion here is only that the events row insert RAN (guard passed).
    const indexer = new EventIndexer(rpcFor(null, fakeTx(log)), CFG, db);
    await indexer.pollOnce();
    expect(indexer.failedTxSkipCount).toBe(0);
    expect(db.calls.filter((c) => c.sql.includes("INSERT INTO events")).length).toBe(1);
  });
});

// ============================================================================
// 4. GET /api/v1/positions?wallet= — shape + validation
// ============================================================================

describe("positions API — userPositionsByWallet + route", () => {
  const WALLET = USER;

  const POSITION_ROW = {
    basket: BASKET,
    basket_symbol: null,
    share_balance: "3860",
    cost_basis: "1403.69898413704",
    cost_basis_source: "reference",
    share_price: "0.363654972942",
    share_price_as_of: "2026-09-05T19:00:00.000Z",
    value_usd: "1403.708195555812",
    updated_at: "2026-09-05T19:30:00.000Z",
  };

  function makeFakeDb(rows: unknown[]) {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const db = {
      calls,
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
      },
    };
    return db as unknown as PgLike & { calls: Array<{ sql: string; values?: unknown[] }> };
  }
  const fakeDb = makeFakeDb;

  it("returns the documented shape: basket/symbol/balance/price/value/costBasis/source + wallet + asOf", async () => {
    const db = fakeDb([POSITION_ROW]);
    const out = await userPositionsByWallet(db, WALLET);
    expect(out.status).toBe(200);
    const payload = out.payload as {
      data: Array<Record<string, unknown>>;
      wallet: string;
      asOf: string;
      count: number;
      source: string;
    };
    expect(payload.wallet).toBe(WALLET);
    expect(payload.count).toBe(1);
    expect(typeof payload.asOf).toBe("string");
    expect(payload.source).toBe("onchain-indexed");
    expect(payload.data[0]).toEqual({
      basket: BASKET,
      basketSymbol: null,
      shareBalance: "3860",
      sharePrice: "0.363654972942",
      valueUsd: "1403.708195555812",
      costBasis: "1403.69898413704",
      source: "reference",
      sharePriceAsOf: "2026-09-05T19:00:00.000Z",
    });
  });

  it("survives NULL nav/price columns (no NAV snapshots yet → nulls, never fabricated)", async () => {
    const db = fakeDb([{ ...POSITION_ROW, share_price: null, value_usd: null, share_price_as_of: null, cost_basis: null, cost_basis_source: null }]);
    const out = await userPositionsByWallet(db, WALLET);
    const item = (out.payload as { data: Array<Record<string, unknown>> }).data[0];
    expect(item.sharePrice).toBeNull();
    expect(item.valueUsd).toBeNull();
    expect(item.costBasis).toBeNull();
    expect(item.source).toBeNull();
  });

  it("empty wallet → 200 with an empty data list (never fabricated)", async () => {
    const out = await userPositionsByWallet(fakeDb([]), WALLET);
    expect(out.status).toBe(200);
    expect((out.payload as { data: unknown[] }).data).toEqual([]);
  });

  // --- handler-level: validation + trust boundary ----------------------------

  function makeReq(url: string): http.IncomingMessage {
    return {
      method: "GET",
      url,
      headers: { host: "localhost:3001" },
      on: (event: string, cb: (chunk?: Buffer) => void) => {
        if (event === "end") cb();
      },
    } as unknown as http.IncomingMessage;
  }

  function makeRes(): { res: http.ServerResponse; state: { statusCode: number; body: string } } {
    const state = { statusCode: 200, body: "" };
    const res = {
      setHeader: () => {},
      get statusCode() { return state.statusCode; },
      set statusCode(v: number) { state.statusCode = v; },
      end: (payload?: string | Buffer) => { state.body = payload ? payload.toString() : ""; },
    };
    return { res: res as unknown as http.ServerResponse, state };
  }

  it("handler: valid wallet answers 200 with the position payload", async () => {
    const handler = createHandler({ db: fakeDb([POSITION_ROW]) });
    const { res, state } = makeRes();
    await handler(makeReq(`/api/v1/positions?wallet=${WALLET}`), res);
    expect(state.statusCode).toBe(200);
    const payload = JSON.parse(state.body) as { wallet: string; data: Array<{ shareBalance: string }> };
    expect(payload.wallet).toBe(WALLET);
    expect(payload.data[0].shareBalance).toBe("3860");
  });

  it("handler: invalid wallet → 400 INVALID_PUBKEY (never reaches the DB layer)", async () => {
    const db = fakeDb([]);
    const handler = createHandler({ db });
    const { res, state } = makeRes();
    await handler(makeReq("/api/v1/positions?wallet=not-a-pubkey!"), res);
    expect(state.statusCode).toBe(400);
    expect(JSON.parse(state.body).error.code).toBe("INVALID_PUBKEY");
    expect(db.calls.length).toBe(0); // validation rejected before any query
  });

  it("handler: missing wallet param → 400 INVALID_PUBKEY", async () => {
    const handler = createHandler({ db: fakeDb([]) });
    const { res, state } = makeRes();
    await handler(makeReq("/api/v1/positions"), res);
    expect(state.statusCode).toBe(400);
    expect(JSON.parse(state.body).error.code).toBe("INVALID_PUBKEY");
  });

  it("handler: DB-less mode → 503 DB_UNAVAILABLE", async () => {
    const handler = createHandler({ db: null });
    const { res, state } = makeRes();
    await handler(makeReq(`/api/v1/positions?wallet=${WALLET}`), res);
    expect(state.statusCode).toBe(503);
    expect(JSON.parse(state.body).error.code).toBe("DB_UNAVAILABLE");
  });

  it("env wiring: POSITIONS_SYNC_MS overrides the default cadence", async () => {
    const { indexerConfigFromEnv } = await import("../src/indexer/listener");
    const cfg = indexerConfigFromEnv({
      RPC_URL: "http://localhost:8899",
      PROGRAM_BASKET: pk(99).toBase58(),
      POSITIONS_SYNC_MS: "45000",
    });
    expect(cfg?.positionsSyncIntervalMs).toBe(45000);
    const cfgDefault = indexerConfigFromEnv({
      RPC_URL: "http://localhost:8899",
      PROGRAM_BASKET: pk(99).toBase58(),
    });
    expect(cfgDefault?.positionsSyncIntervalMs).toBe(120000);
  });
});
