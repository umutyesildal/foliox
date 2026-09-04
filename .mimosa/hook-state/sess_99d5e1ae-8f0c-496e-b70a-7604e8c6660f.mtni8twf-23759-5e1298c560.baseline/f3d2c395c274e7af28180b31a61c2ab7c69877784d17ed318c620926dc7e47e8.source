/**
 * positions.test.ts — event-driven user_positions sync (indexer/positions.ts).
 *
 * Covers: mint credits + reference cost basis, redeem burns + proportional
 * cost scaling, 90/10 fee-to-creator/treasury rows, (sig, kind) idempotent
 * replay, u64-integer safety (beyond 2^53), null-DB degradation, and the
 * listener wiring end-to-end. Uses a stateful fake PgLike (waveb pattern)
 * that actually simulates the position_events ledger and user_positions
 * table so balance math is asserted across calls. No RPC, no real Postgres.
 */
import { describe, it, expect } from "vitest";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";

import type { PgLike } from "../src/db/client";
import { ANCHOR_EVENT_DISCRIMINATORS, type MintedEvent } from "../src/indexer/events";
import { EventIndexer, type SolanaRpc } from "../src/indexer/listener";
import {
  applyFeeAccrued,
  applyMinted,
  applyPositionEvent,
  applyRedeemed,
  decimalToFixed,
  fixedToDecimalString,
} from "../src/indexer/positions";

// --- stateful fake PgLike ------------------------------------------------------

interface FakePositionRow {
  user: string;
  basket: string;
  share_balance: string;
  cost_basis: string | null;
  cost_basis_source: string | null;
}

type FakePositionsDb = PgLike & {
  calls: Array<{ sql: string; values?: unknown[] }>;
  positions: Map<string, FakePositionRow>;
  positionClaims: Set<string>;
  eventSigs: Set<string>;
};

/**
 * In-memory double: routes by SQL fragment like the waveb fakeDb but keeps
 * real state for position_events (the idempotency ledger), user_positions,
 * and the events PK so replay semantics are exercised for real.
 */
function positionsDb(
  opts: { sharePrice?: string | null; creator?: string | null; treasury?: string | null } = {},
): FakePositionsDb {
  const positions = new Map<string, FakePositionRow>();
  const positionClaims = new Set<string>();
  const eventSigs = new Set<string>();
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const key = (user: unknown, basket: unknown) => `${user}|${basket}`;
  const db = {
    calls,
    positions,
    positionClaims,
    eventSigs,
    query: async (sql: string, values: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
      calls.push({ sql, values });
      if (sql.includes("INSERT INTO position_events")) {
        const k = `${values[0]}|${values[1]}`;
        if (positionClaims.has(k)) return { rows: [], rowCount: 0 };
        positionClaims.add(k);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO events")) {
        if (eventSigs.has(values[0] as string)) return { rows: [], rowCount: 0 };
        eventSigs.add(values[0] as string);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM nav_snapshots")) {
        const rows = opts.sharePrice ? [{ share_price: opts.sharePrice }] : [];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("FROM baskets WHERE pubkey")) {
        const rows = opts.creator && opts.treasury ? [{ creator: opts.creator, treasury: opts.treasury }] : [];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("DELETE FROM user_positions")) {
        positions.delete(key(values[0], values[1]));
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO user_positions")) {
        positions.set(key(values[0], values[1]), {
          user: values[0] as string,
          basket: values[1] as string,
          share_balance: values[2] as string,
          cost_basis: (values[3] as string | null) ?? null,
          cost_basis_source: (values[4] as string | null) ?? null,
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE user_positions")) {
        const row = positions.get(key(values[0], values[1]));
        if (!row) return { rows: [], rowCount: 0 };
        row.share_balance = values[2] as string;
        row.cost_basis = (values[3] as string | null) ?? null;
        if (sql.includes("cost_basis_source")) row.cost_basis_source = (values[4] as string | null) ?? null;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM user_positions")) {
        const row = positions.get(key(values[0], values[1]));
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return db as unknown as FakePositionsDb;
}

// --- fixtures -------------------------------------------------------------------

const pk = (n: number) => new PublicKey(Buffer.alloc(32, n));
const BASKET = pk(10).toBase58();
const USER = pk(20).toBase58();
const CREATOR = pk(11).toBase58();
const TREASURY = pk(12).toBase58();

function minted(over: Partial<MintedEvent> = {}): MintedEvent {
  return {
    type: "Minted",
    basket: BASKET,
    user: USER,
    grossShares: "1001000",
    netShares: "1000000",
    entryFeeShares: "1000",
    ...over,
  };
}

function redeemed(over: Partial<{ sharesBurned: string; exitFeeShares: string }> = {}) {
  return {
    type: "Redeemed" as const,
    basket: BASKET,
    user: USER,
    sharesBurned: "995000",
    exitFeeShares: "5000",
    ...over,
  };
}

// ============================================================================
// 1. fixed-point helpers (BigInt only)
// ============================================================================

describe("positions — decimal fixed-point helpers", () => {
  it("decimalToFixed parses plain decimals, truncates extras, rejects garbage", () => {
    expect(decimalToFixed("0.155")).toBe(155000000000n);
    expect(decimalToFixed("191000")).toBe(191000000000000000n);
    expect(decimalToFixed("-2.5")).toBe(-2500000000000n);
    expect(decimalToFixed("0.1234567890123456")).toBe(123456789012n); // truncates at 12
    expect(decimalToFixed(null)).toBeNull();
    expect(decimalToFixed("abc")).toBeNull();
    expect(decimalToFixed("1e21")).toBeNull();
  });

  it("fixedToDecimalString round-trips without trailing zeros", () => {
    expect(fixedToDecimalString(155000000000000000n)).toBe("155000");
    expect(fixedToDecimalString(123456789012n)).toBe("0.123456789012");
    expect(fixedToDecimalString(0n)).toBe("0");
    expect(fixedToDecimalString(-1500500000000n)).toBe("-1.5005");
  });
});

// ============================================================================
// 2. applyMinted — balance up, reference cost basis, fee split
// ============================================================================

describe("positions — applyMinted", () => {
  it("credits the user netShares and sets cost_basis from the latest share_price (marked 'reference')", async () => {
    const db = positionsDb({ sharePrice: "0.155" }); // no baskets row -> fee split skipped
    expect(await applyMinted(db, "SIG-M1", minted())).toBe(true);
    const row = db.positions.get(`${USER}|${BASKET}`);
    expect(row).toBeDefined();
    expect(row!.share_balance).toBe("1000000"); // decimal string -> BIGINT-safe
    expect(row!.cost_basis).toBe("155000"); // 1M raw × 0.155 USD, exact fixed point
    expect(row!.cost_basis_source).toBe("reference");
  });

  it("entry fee splits 90/10 to creator and treasury with NO cost basis", async () => {
    const db = positionsDb({ sharePrice: "1", creator: CREATOR, treasury: TREASURY });
    await applyMinted(db, "SIG-M2", minted({ entryFeeShares: "1000" }));
    expect(db.positions.get(`${CREATOR}|${BASKET}`)).toMatchObject({
      share_balance: "900",
      cost_basis: null,
      cost_basis_source: null,
    });
    expect(db.positions.get(`${TREASURY}|${BASKET}`)).toMatchObject({
      share_balance: "100",
      cost_basis: null,
      cost_basis_source: null,
    });
  });

  it("leaves cost_basis NULL when no nav snapshot exists (never fabricated)", async () => {
    const db = positionsDb();
    await applyMinted(db, "SIG-M3", minted({ entryFeeShares: "0" }));
    expect(db.positions.get(`${USER}|${BASKET}`)).toMatchObject({
      share_balance: "1000000",
      cost_basis: null,
      cost_basis_source: null,
    });
  });

  it("blends cost_basis across mints at the then-current share_price", async () => {
    const db = positionsDb({ sharePrice: "0.155" });
    await applyMinted(db, "SIG-M4a", minted());
    await applyMinted(db, "SIG-M4b", minted({ netShares: "2000000", entryFeeShares: "0" }));
    expect(db.positions.get(`${USER}|${BASKET}`)).toMatchObject({
      share_balance: "3000000",
      cost_basis: "465000", // 155000 + 310000
      cost_basis_source: "reference",
    });
  });

  it("stays exact beyond Number.MAX_SAFE_INTEGER (2^53+1 twice)", async () => {
    const db = positionsDb({ sharePrice: "1" });
    const huge = "9007199254740993"; // NOT representable as f64
    await applyMinted(db, "SIG-M5a", minted({ netShares: huge, grossShares: huge, entryFeeShares: "0" }));
    await applyMinted(db, "SIG-M5b", minted({ netShares: huge, grossShares: huge, entryFeeShares: "0" }));
    expect(db.positions.get(`${USER}|${BASKET}`)!.share_balance).toBe("18014398509481986");
    expect(db.positions.get(`${USER}|${BASKET}`)!.cost_basis).toBe("18014398509481986");
  });
});

// ============================================================================
// 3. applyRedeemed — balance down, proportional cost, zero-balance cleanup
// ============================================================================

describe("positions — applyRedeemed", () => {
  async function seeded(): Promise<FakePositionsDb> {
    const db = positionsDb({ sharePrice: "0.155" });
    await applyMinted(db, "SIG-R0", minted());
    await applyMinted(db, "SIG-R0b", minted({ netShares: "2000000", entryFeeShares: "0" }));
    return db; // balance 3,000,000 @ cost 465,000
  }

  it("decreases balance by sharesBurned + exitFeeShares and scales cost_basis proportionally", async () => {
    const db = await seeded();
    expect(await applyRedeemed(db, "SIG-R1", redeemed({ sharesBurned: "1000000", exitFeeShares: "5000" }))).toBe(true);
    expect(db.positions.get(`${USER}|${BASKET}`)).toMatchObject({
      share_balance: "1995000", // 3,000,000 - 1,005,000
      cost_basis: "309225", // 465,000 × 1,995,000 / 3,000,000 (exact, floor)
      cost_basis_source: "reference", // provenance survives the redeem
    });
  });

  it("deletes the row on a full redeem so holders COUNT stays honest", async () => {
    const db = positionsDb();
    await applyMinted(db, "SIG-R2a", minted({ entryFeeShares: "0" }));
    expect(await applyRedeemed(db, "SIG-R2b", redeemed())).toBe(true); // 995,000 + 5,000 = full
    expect(db.positions.has(`${USER}|${BASKET}`)).toBe(false);
  });

  it("redeem without an indexed position writes nothing for the user but still pays the fee split", async () => {
    const db = positionsDb({ creator: CREATOR, treasury: TREASURY });
    expect(await applyRedeemed(db, "SIG-R3", redeemed({ exitFeeShares: "1000" }))).toBe(true);
    expect(db.positions.has(`${USER}|${BASKET}`)).toBe(false); // never negative
    expect(db.positions.get(`${CREATOR}|${BASKET}`)!.share_balance).toBe("900");
    expect(db.positions.get(`${TREASURY}|${BASKET}`)!.share_balance).toBe("100");
  });

  it("floors the proportional cost when the division is inexact", async () => {
    const price = { sharePrice: "0.1" };
    const db = positionsDb(price);
    await applyMinted(db, "SIG-R4a", minted({ netShares: "1", grossShares: "1", entryFeeShares: "0" })); // cost 0.1
    price.sharePrice = "0.155";
    await applyMinted(db, "SIG-R4a2", minted({ netShares: "2", grossShares: "2", entryFeeShares: "0" })); // +0.31 → 0.41 @ 3 shares
    // redeem 1 of 3: 0.41 × 2/3 = 0.27333… → floor at scale 12
    await applyRedeemed(db, "SIG-R4b", redeemed({ sharesBurned: "1", exitFeeShares: "0" }));
    expect(db.positions.get(`${USER}|${BASKET}`)!.share_balance).toBe("2");
    expect(db.positions.get(`${USER}|${BASKET}`)!.cost_basis).toBe("0.273333333333");
  });
});

// ============================================================================
// 4. applyFeeAccrued — management fee to creator/treasury
// ============================================================================

describe("positions — applyFeeAccrued", () => {
  it("credits sharesMinted 90/10 to the creator and treasury resolved from the baskets row", async () => {
    const db = positionsDb({ creator: CREATOR, treasury: TREASURY });
    expect(await applyFeeAccrued(db, "SIG-F1", { type: "FeeAccrued", basket: BASKET, sharesMinted: "10000", elapsedSec: "3600" })).toBe(true);
    expect(db.positions.get(`${CREATOR}|${BASKET}`)).toMatchObject({
      share_balance: "9000",
      cost_basis: null,
      cost_basis_source: null,
    });
    expect(db.positions.get(`${TREASURY}|${BASKET}`)!.share_balance).toBe("1000");
  });

  it("dust goes to treasury (fee of 1) and skips lookups when nothing accrued", async () => {
    const db = positionsDb({ creator: CREATOR, treasury: TREASURY });
    await applyFeeAccrued(db, "SIG-F2", { type: "FeeAccrued", basket: BASKET, sharesMinted: "1", elapsedSec: "1" });
    expect(db.positions.get(`${CREATOR}|${BASKET}`)).toBeUndefined(); // floor(0.9) = 0
    expect(db.positions.get(`${TREASURY}|${BASKET}`)!.share_balance).toBe("1");
    db.calls.length = 0;
    await applyFeeAccrued(db, "SIG-F3", { type: "FeeAccrued", basket: BASKET, sharesMinted: "0", elapsedSec: "0" });
    expect(db.calls.filter((c) => c.sql.includes("FROM baskets")).length).toBe(0); // nothing to do
  });

  it("degrades when the basket is not indexed yet — no fabricated recipients", async () => {
    const db = positionsDb(); // no baskets row
    expect(await applyFeeAccrued(db, "SIG-F4", { type: "FeeAccrued", basket: BASKET, sharesMinted: "10", elapsedSec: "1" })).toBe(true);
    expect(db.positions.size).toBe(0);
  });
});

// ============================================================================
// 5. idempotency + degradation + dispatch
// ============================================================================

describe("positions — idempotency, degradation, dispatch", () => {
  it("replaying the same (sig, kind) is a no-op — no double count", async () => {
    const db = positionsDb({ sharePrice: "0.155" });
    expect(await applyMinted(db, "SIG-DUP", minted())).toBe(true);
    expect(await applyMinted(db, "SIG-DUP", minted())).toBe(false); // ledger blocks it
    expect(db.positionClaims.size).toBe(1);
    expect(db.positions.get(`${USER}|${BASKET}`)).toMatchObject({ share_balance: "1000000", cost_basis: "155000" });
    // a different signature for the same action still applies
    expect(await applyMinted(db, "SIG-OTHER", minted())).toBe(true);
    expect(db.positions.get(`${USER}|${BASKET}`)!.share_balance).toBe("2000000");
  });

  it("same sig with a different kind is a distinct claim (tx can carry both)", async () => {
    const db = positionsDb({ creator: CREATOR, treasury: TREASURY });
    await applyMinted(db, "SIG-MIX", minted({ entryFeeShares: "0" }));
    await applyFeeAccrued(db, "SIG-MIX", { type: "FeeAccrued", basket: BASKET, sharesMinted: "100", elapsedSec: "1" });
    expect(db.positions.get(`${USER}|${BASKET}`)!.share_balance).toBe("1000000");
    expect(db.positions.get(`${CREATOR}|${BASKET}`)!.share_balance).toBe("90");
  });

  it("null DB degrades honestly: false, no throw, for every apply*", async () => {
    expect(await applyMinted(null, "S", minted())).toBe(false);
    expect(await applyRedeemed(null, "S", redeemed())).toBe(false);
    expect(await applyFeeAccrued(null, "S", { type: "FeeAccrued", basket: BASKET, sharesMinted: "1", elapsedSec: "1" })).toBe(false);
    expect(await applyPositionEvent(null, "S", minted())).toBe(false);
  });

  it("applyPositionEvent dispatches by type; BasketCreated touches nothing", async () => {
    const db = positionsDb({ sharePrice: "1" });
    expect(await applyPositionEvent(db, "SIG-D1", minted({ entryFeeShares: "0" }))).toBe(true);
    expect(db.positions.get(`${USER}|${BASKET}`)!.share_balance).toBe("1000000");
    db.calls.length = 0;
    expect(
      await applyPositionEvent(db, "SIG-D2", { type: "BasketCreated", basket: BASKET, creator: CREATOR, numConstituents: 2, shareMint: pk(30).toBase58(), ts: 0 }),
    ).toBe(false);
    expect(db.calls.length).toBe(0);
  });
});

// ============================================================================
// 6. listener wiring — end-to-end through pollOnce
// ============================================================================

describe("positions — listener wiring", () => {
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

  function fakeTx(logs: string[]): ParsedTransactionWithMeta {
    return {
      transaction: { message: { instructions: [] } },
      meta: { logMessages: logs, innerInstructions: [], slot: 42 },
    } as unknown as ParsedTransactionWithMeta;
  }

  function rpcFor(tx: ParsedTransactionWithMeta): SolanaRpc {
    return {
      async getSignaturesForAddress() {
        return [{ signature: "MSIG1", slot: 42, err: null, blockTime: 1725148800 }];
      },
      async getParsedTransaction() {
        return tx;
      },
      async getAccountInfo() {
        return null;
      },
    };
  }

  const CFG = { programIds: [pk(99).toBase58()], pollIntervalMs: 1000, signaturesPerPoll: 10, maxSeenCache: 100 };

  it("pollOnce applies a Minted log to user_positions and a replayed poll never double-counts", async () => {
    const db = positionsDb({ sharePrice: "1" });
    const ev = minted({ entryFeeShares: "0" });
    const tx = fakeTx([`Program data: ${mintedLogPayload(ev).toString("base64")}`]);

    await new EventIndexer(rpcFor(tx), CFG, db).pollOnce();
    expect(db.positions.get(`${USER}|${BASKET}`)).toMatchObject({
      share_balance: "1000000",
      cost_basis: "1000000",
      cost_basis_source: "reference",
    });

    // fresh indexer (empty seen cache) re-processes the same signature:
    // the events PK and the position_events ledger both refuse the replay.
    await new EventIndexer(rpcFor(tx), CFG, db).pollOnce();
    expect(db.positions.get(`${USER}|${BASKET}`)!.share_balance).toBe("1000000");
    expect(db.positionClaims.size).toBe(1);
  });
});
