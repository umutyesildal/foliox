/**
 * backend-truth.test.ts — Wave B tasks 2-3: real DB schema, Anchor event
 * decoding, Token-2022 multiplier parsing, price-fetch caching/markers, and
 * DB-less degradation contracts. All fixtures are hand-built bytes, no RPC.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { PublicKey, type AccountInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ExtensionType } from "@solana/spl-token";
import bs58 from "bs58";

import {
  ANCHOR_EVENT_DISCRIMINATORS,
  CREATE_BASKET_IX_DISCRIMINATOR,
  anchorEventDiscriminator,
  decodeAnchorEvent,
  decodeCreateBasketIx,
  decodeEventLog,
  decodeFactoryTreasury,
  extractProgramDataLogs,
  matchAnchorEvent,
  type BasketCreatedEvent,
  type FeeAccruedEvent,
  type MintedEvent,
  type RedeemedEvent,
} from "../src/indexer/events";
import {
  EventIndexer,
  insertEvent,
  insertEvents,
  type BasketUpsert,
  type EventRow,
  type SolanaRpc,
} from "../src/indexer/listener";
import {
  deriveBasketPda,
  exactScaledDecimalString,
  fetchMultiplier,
  getVaultAtas,
  parseMintDecimalsFromMintData,
  parseScaledUiMultiplierFromMintData,
  syncHoldings,
  upsertVaultHoldings,
  u64LeBytes,
  type HoldingsRow,
} from "../src/indexer/holdingsSync";
import { applySchema, ensureSchemaFromEnv, loadSchemaSql, schemaCandidates } from "../src/db/init";
import {
  PRICE_CACHE_TTL_MS,
  clearPriceCache,
  fetchPrices,
  fetchPriceQuotes,
  mockPriceQuotes,
  mockPrices,
} from "../src/workers/priceFetch";

// --- deterministic fixtures --------------------------------------------------

const pk = (n: number): PublicKey => new PublicKey(Buffer.alloc(32, n));

function sha8(input: string): Buffer {
  return createHash("sha256").update(input).digest().subarray(0, 8);
}

const u16le = (v: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const u32le = (v: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const u64le = (v: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const i64le = (v: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
};

/** Token-2022 mint fixture: base padded to 165, AccountType at 165, TLV at 166. */
function buildToken2022Mint(multiplier: number | null, decimals = 6): Buffer {
  const base = Buffer.alloc(165);
  base.writeUInt8(decimals, 44);
  base.writeUInt8(1, 45); // isInitialized
  const tlv = Buffer.alloc(4 + 56);
  tlv.writeUInt16LE(ExtensionType.ScaledUiAmountConfig, 0);
  tlv.writeUInt16LE(56, 2);
  pk(9).toBuffer().copy(tlv, 4); // authority
  tlv.writeDoubleLE(multiplier ?? 1.0, 36); // multiplier (f64)
  tlv.writeBigUInt64LE(0n, 44); // newMultiplierEffectiveTimestamp
  tlv.writeDoubleLE(multiplier ?? 1.0, 52); // newMultiplier (f64)
  return Buffer.concat([base, Buffer.from([1]), tlv]);
}

/** Legacy SPL token account fixture (165 bytes, amount at offset 64). */
function buildTokenAccount(mint: PublicKey, owner: PublicKey, amount: bigint, programId: PublicKey): AccountInfo<Buffer> {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt8(1, 108); // state = Initialized
  return { executable: false, owner: programId, lamports: 1, data, rentEpoch: undefined };
}

function accountInfo(owner: PublicKey, data: Buffer): AccountInfo<Buffer> {
  return { executable: false, owner, lamports: 1, data, rentEpoch: undefined };
}

function fakeDb(rowCount = 1) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    calls,
    query: async (sql: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: unknown[] }> => {
      calls.push({ sql, values });
      return { rowCount, rows: [] };
    },
  };
}

// --- 1. Anchor event discriminator matcher -----------------------------------

describe("indexer/events — discriminator matcher", () => {
  it("derives 8-byte sha256('event:<Name>') discriminators", () => {
    expect(anchorEventDiscriminator("Minted")).toEqual(sha8("event:Minted"));
    expect(anchorEventDiscriminator("Minted").length).toBe(8);
    for (const [name, disc] of Object.entries(ANCHOR_EVENT_DISCRIMINATORS)) {
      expect(disc).toEqual(sha8(`event:${name}`));
    }
  });

  it("matches each of the four FolioX events by prefix", () => {
    for (const type of ["BasketCreated", "Minted", "Redeemed", "FeeAccrued"] as const) {
      const payload = Buffer.concat([ANCHOR_EVENT_DISCRIMINATORS[type], Buffer.alloc(48)]);
      expect(matchAnchorEvent(payload)).toBe(type);
    }
  });

  it("returns null for unknown / short payloads", () => {
    expect(matchAnchorEvent(Buffer.alloc(4))).toBeNull();
    expect(matchAnchorEvent(Buffer.concat([sha8("event:NotAnEvent"), Buffer.alloc(48)]))).toBeNull();
  });

  it("extracts Program data logs from log messages", () => {
    const payload = Buffer.concat([ANCHOR_EVENT_DISCRIMINATORS.Minted, Buffer.alloc(10)]);
    const logs = [
      "Program 37VPG.. invoke [1]",
      `Program data: ${payload.toString("base64")}`,
      "Program 37VPG.. success",
    ];
    const out = extractProgramDataLogs(logs);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(payload);
    expect(extractProgramDataLogs(["no data here"])).toHaveLength(0);
  });
});

// --- 2. Event Borsh decoding (u64 fields stay decimal strings) ---------------

describe("indexer/events — Borsh decoding", () => {
  it("decodes BasketCreated", () => {
    const payload = Buffer.concat([
      ANCHOR_EVENT_DISCRIMINATORS.BasketCreated,
      pk(1).toBuffer(),
      pk(2).toBuffer(),
      Buffer.from([3]),
      pk(4).toBuffer(),
      i64le(1725148800n),
    ]);
    const event = decodeAnchorEvent("BasketCreated", payload) as BasketCreatedEvent;
    expect(event).not.toBeNull();
    expect(event.basket).toBe(pk(1).toBase58());
    expect(event.creator).toBe(pk(2).toBase58());
    expect(event.numConstituents).toBe(3);
    expect(event.shareMint).toBe(pk(4).toBase58());
    expect(event.ts).toBe(1725148800);
  });

  it("decodes Minted with u64-max values as exact decimal strings", () => {
    const payload = Buffer.concat([
      ANCHOR_EVENT_DISCRIMINATORS.Minted,
      pk(1).toBuffer(),
      pk(2).toBuffer(),
      u64le(18446744073709551615n), // u64 max — past Number.MAX_SAFE_INTEGER
      u64le(990000n),
      u64le(10000n),
    ]);
    const event = decodeAnchorEvent("Minted", payload) as MintedEvent;
    expect(event.grossShares).toBe("18446744073709551615");
    expect(event.netShares).toBe("990000");
    expect(event.entryFeeShares).toBe("10000");
    expect(event.user).toBe(pk(2).toBase58());
  });

  it("decodes Redeemed and FeeAccrued", () => {
    const redeemed = decodeAnchorEvent("Redeemed", Buffer.concat([
      ANCHOR_EVENT_DISCRIMINATORS.Redeemed,
      pk(1).toBuffer(),
      pk(2).toBuffer(),
      u64le(995000n),
      u64le(5000n),
    ])) as RedeemedEvent;
    expect(redeemed.sharesBurned).toBe("995000");
    expect(redeemed.exitFeeShares).toBe("5000");

    const fee = decodeAnchorEvent("FeeAccrued", Buffer.concat([
      ANCHOR_EVENT_DISCRIMINATORS.FeeAccrued,
      pk(1).toBuffer(),
      u64le(16438n),
      u64le(2592000n),
    ])) as FeeAccruedEvent;
    expect(fee.sharesMinted).toBe("16438");
    expect(fee.elapsedSec).toBe("2592000");
  });

  it("returns null on truncated bodies and wrong discriminators", () => {
    const short = Buffer.concat([ANCHOR_EVENT_DISCRIMINATORS.Redeemed, pk(1).toBuffer(), pk(2).toBuffer()]);
    expect(decodeAnchorEvent("Redeemed", short)).toBeNull();
    const wrong = Buffer.concat([ANCHOR_EVENT_DISCRIMINATORS.FeeAccrued, Buffer.alloc(48)]);
    expect(decodeAnchorEvent("Redeemed", wrong)).toBeNull();
  });

  it("decodeEventLog round-trips a Program data log line", () => {
    const payload = Buffer.concat([
      ANCHOR_EVENT_DISCRIMINATORS.BasketCreated,
      pk(1).toBuffer(),
      pk(2).toBuffer(),
      Buffer.from([2]),
      pk(4).toBuffer(),
      i64le(1725148800n),
    ]);
    const event = decodeEventLog(`Program data: ${payload.toString("base64")}`) as BasketCreatedEvent;
    expect(event?.type).toBe("BasketCreated");
    expect(decodeEventLog("Program data: not-base64!!")).toBeNull();
    expect(decodeEventLog("Program log: nothing")).toBeNull();
  });
});

// --- 3. create_basket instruction args + FactoryConfig -----------------------

describe("indexer/events — create_basket args decoding", () => {
  function buildCreateBasketData(): Buffer {
    return Buffer.concat([
      CREATE_BASKET_IX_DISCRIMINATOR,
      u64le(7n), // nonce
      u32le(3), ...[pk(1), pk(2), pk(3)].map((k) => k.toBuffer()),
      u32le(3), u16le(5000), u16le(3000), u16le(2000),
      u16le(100), u16le(50), u16le(200),
      Buffer.alloc(32, 7), // metadata_hash
      u32le(3), u64le(500n), u64le(300n), u64le(200n),
    ]);
  }

  it("decodes all create_basket args (u64 as strings)", () => {
    const buf = buildCreateBasketData();
    const args = decodeCreateBasketIx(buf);
    expect(args).not.toBeNull();
    expect(args?.nonce).toBe("7");
    expect(args?.constituents).toEqual([pk(1).toBase58(), pk(2).toBase58(), pk(3).toBase58()]);
    expect(args?.weightsBps).toEqual([5000, 3000, 2000]);
    expect(args?.entryFeeBps).toBe(100);
    expect(args?.exitFeeBps).toBe(50);
    expect(args?.managementFeeBps).toBe(200);
    expect(args?.metadataHashHex).toBe("07".repeat(32));
    expect(args?.seedAmounts).toEqual(["500", "300", "200"]);
  });

  it("accepts the base58 instruction-data string from JSON RPC", () => {
    const args = decodeCreateBasketIx(bs58.encode(buildCreateBasketData()));
    expect(args?.nonce).toBe("7");
    expect(args?.constituents).toHaveLength(3);
  });

  it("rejects foreign instruction data", () => {
    expect(decodeCreateBasketIx(Buffer.concat([sha8("global:other_ix"), Buffer.alloc(64)]))).toBeNull();
    expect(decodeCreateBasketIx("not-base58!!!")).toBeNull();
  });

  it("decodes the treasury out of a FactoryConfig account", () => {
    const factory = Buffer.concat([Buffer.alloc(8), pk(5).toBuffer(), pk(6).toBuffer()]);
    expect(decodeFactoryTreasury(factory)).toBe(pk(6).toBase58());
    expect(decodeFactoryTreasury(Buffer.alloc(40))).toBeNull();
    expect(decodeFactoryTreasury(null)).toBeNull();
  });
});

// --- 4. Token-2022 ScaledUiAmountConfig multiplier parsing -------------------

describe("indexer/holdingsSync — multiplier parsing (fixture bytes)", () => {
  it("parses f64 multiplier 2.0 from a Token-2022 mint with the extension", () => {
    const data = buildToken2022Mint(2.0);
    expect(parseScaledUiMultiplierFromMintData(data)).toBe(2.0);
    expect(parseMintDecimalsFromMintData(data)).toBe(6);
  });

  it("parses sub-1.0 multipliers (dividend case, 0.95)", () => {
    expect(parseScaledUiMultiplierFromMintData(buildToken2022Mint(0.95))).toBeCloseTo(0.95, 12);
  });

  it("falls back to null (-> 1.0) for legacy / malformed mint data", () => {
    expect(parseScaledUiMultiplierFromMintData(Buffer.alloc(82))).toBeNull(); // base mint, no TLV
    const wrongType = buildToken2022Mint(2.0);
    wrongType[165] = 2; // AccountType != Mint
    expect(parseScaledUiMultiplierFromMintData(wrongType)).toBeNull();
    expect(parseScaledUiMultiplierFromMintData(Buffer.alloc(226, 3))).toBeNull(); // garbage, no crash
    expect(parseMintDecimalsFromMintData(Buffer.alloc(10))).toBeNull();
    expect(parseMintDecimalsFromMintData(buildToken2022Mint(1.0, 200))).toBeNull(); // implausible decimals
  });

  it("fetchMultiplier degrades to 1.0 on legacy program owner and missing account", async () => {
    const mint = pk(3);
    const legacyRpc: SolanaRpc = {
      async getAccountInfo() {
        return accountInfo(TOKEN_PROGRAM_ID, Buffer.alloc(82));
      },
      async getMultipleAccountsInfo() {
        return [];
      },
    };
    expect(await fetchMultiplier(legacyRpc, mint)).toBe(1.0);
    const emptyRpc: SolanaRpc = {
      async getAccountInfo() {
        return null;
      },
      async getMultipleAccountsInfo() {
        return [];
      },
    };
    expect(await fetchMultiplier(emptyRpc, mint)).toBe(1.0);
    const throwingRpc: SolanaRpc = {
      async getAccountInfo(): Promise<AccountInfo<Buffer> | null> {
        throw new Error("rpc down");
      },
      async getMultipleAccountsInfo() {
        return [];
      },
    };
    expect(await fetchMultiplier(throwingRpc, mint)).toBe(1.0);
  });
});

// --- 5. exact scaled math (integer-safe) -------------------------------------

describe("indexer/holdingsSync — exactScaledDecimalString", () => {
  it("computes display units exactly for normal values", () => {
    expect(exactScaledDecimalString(500_000_000n, 1.0, 6)).toBe("500");
    expect(exactScaledDecimalString(500_000_000n, 2.0, 6)).toBe("1000");
    expect(exactScaledDecimalString(1n, 0.95, 6)).toBe("0.00000095");
  });

  it("keeps u64-max raw exact in the string (never a truncated Number)", () => {
    const out = exactScaledDecimalString(9223372036854775808n, 2.0, 6);
    expect(out).toBe("18446744073709.551616");
  });

  it("handles zero and invalid multipliers honestly", () => {
    expect(exactScaledDecimalString(0n, 2.0, 6)).toBe("0");
    expect(exactScaledDecimalString(123n, Number.NaN, 6)).toBe("0");
    expect(exactScaledDecimalString(123n, -1, 6)).toBe("0");
  });
});

// --- 6. syncHoldings end-to-end with a stub RPC ------------------------------

describe("indexer/holdingsSync — syncHoldings", () => {
  const mint = pk(3);
  const ata = pk(4);
  const basket = pk(5);

  it("stores raw as bigint/string, multiplier, scaled, decimals — no Number truncation", async () => {
    const rawAmount = 9223372036854775808n; // 2^63 — far beyond MAX_SAFE_INTEGER
    const rpc: SolanaRpc = {
      async getAccountInfo() {
        return accountInfo(TOKEN_2022_PROGRAM_ID, buildToken2022Mint(2.0, 6));
      },
      async getMultipleAccountsInfo(keys) {
        expect(keys).toEqual([ata]);
        return [buildTokenAccount(mint, basket, rawAmount, TOKEN_2022_PROGRAM_ID)];
      },
    };
    const rows = await syncHoldings(rpc, basket, [ata], [mint]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.raw).toBe(rawAmount);
    expect(row.rawAmount).toBe("9223372036854775808");
    expect(row.multiplier).toBe(2.0);
    expect(row.decimals).toBe(6);
    expect(row.scaledAmount).toBe("18446744073709.551616");
    expect(row.scaled).toBeCloseTo(18446744073709.551616, 3);
  });

  it("missing ATAs degrade to zero rows without throwing", async () => {
    const rpc: SolanaRpc = {
      async getAccountInfo() {
        return accountInfo(TOKEN_2022_PROGRAM_ID, buildToken2022Mint(null, 6));
      },
      async getMultipleAccountsInfo() {
        return [null];
      },
    };
    const rows = await syncHoldings(rpc, basket, [ata], [mint]);
    expect(rows[0].raw).toBe(0n);
    expect(rows[0].multiplier).toBe(1.0);
    expect(rows[0].scaledAmount).toBe("0");
  });

  it("upserts vault_holdings with raw bound as a decimal string", async () => {
    const db = fakeDb(1);
    const row: HoldingsRow = {
      basket: basket.toBase58(),
      mint: mint.toBase58(),
      raw: 18446744073709551615n,
      rawAmount: "18446744073709551615",
      multiplier: 1.5,
      scaled: 27670116110564327.4,
      scaledAmount: "27670116110564327.424",
      decimals: 6,
    };
    expect(await upsertVaultHoldings(db, [row])).toBe(true);
    expect(db.calls).toHaveLength(2); // whitelisted_mints ensure + vault_holdings upsert
    const holdingsCall = db.calls[1];
    expect(holdingsCall.sql).toContain("INSERT INTO vault_holdings");
    expect(holdingsCall.values?.[2]).toBe("18446744073709551615"); // string, not number
    expect(holdingsCall.values?.[4]).toBe("27670116110564327.424");
  });

  it("upsertVaultHoldings is a no-op without a db (DB-less)", async () => {
    expect(await upsertVaultHoldings(null, [])).toBe(false);
  });

  it("derives basket PDA and vault ATAs deterministically", () => {
    const pda = deriveBasketPda(pk(1), pk(2), "7");
    const pdaAgain = deriveBasketPda(pk(1), pk(2), 7n);
    expect(pda.toBase58()).toBe(pdaAgain.toBase58());
    const atas = getVaultAtas(pda, [pk(3), pk(4)]);
    expect(atas).toHaveLength(2);
    expect(u64LeBytes("18446744073709551615").length).toBe(8);
  });
});

// --- 7. Listener: decode + DB upserts / DB-less degradation ------------------

const FACTORY_PROGRAM = new PublicKey("3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF");

function buildCreateBasketData(): Buffer {
  return Buffer.concat([
    CREATE_BASKET_IX_DISCRIMINATOR,
    u64le(7n),
    u32le(2), ...[pk(1), pk(2)].map((k) => k.toBuffer()),
    u32le(2), u16le(6000), u16le(4000),
    u16le(100), u16le(50), u16le(200),
    Buffer.alloc(32, 7),
    u32le(2), u64le(500n), u64le(300n),
  ]);
}

function buildBasketCreatedPayload(): Buffer {
  return Buffer.concat([
    ANCHOR_EVENT_DISCRIMINATORS.BasketCreated,
    pk(10).toBuffer(), // basket
    pk(11).toBuffer(), // creator
    Buffer.from([2]), // num_constituents
    pk(12).toBuffer(), // share_mint
    i64le(1725148800n), // ts
  ]);
}

function fakeTx(logs: string[], ixs: Array<{ programId: PublicKey; accounts: PublicKey[]; data: string }>): ParsedTransactionWithMeta {
  return {
    transaction: { message: { instructions: ixs } },
    meta: { logMessages: logs, innerInstructions: [], slot: 42 },
  } as unknown as ParsedTransactionWithMeta;
}

function rpcForTx(tx: ParsedTransactionWithMeta, factoryAccount: Buffer): SolanaRpc {
  return {
    async getSignaturesForAddress() {
      return [{ signature: "SIG1", slot: 42, err: null, blockTime: 1725148800 }];
    },
    async getParsedTransaction() {
      return tx;
    },
    async getAccountInfo() {
      return accountInfo(FACTORY_PROGRAM, factoryAccount);
    },
  };
}

describe("indexer/listener — pollOnce + DB upserts", () => {
  const payload = buildBasketCreatedPayload();
  const ixDisc = CREATE_BASKET_IX_DISCRIMINATOR;
  const factoryAccount = Buffer.concat([Buffer.alloc(8), pk(5).toBuffer(), pk(6).toBuffer()]);

  it("decodes events and upserts events + baskets + creator_stats", async () => {
    const db = fakeDb(1);
    const tx = fakeTx(
      [`Program data: ${payload.toString("base64")}`],
      [{ programId: FACTORY_PROGRAM, accounts: [pk(5), pk(10), pk(12), pk(11)], data: bs58.encode(buildCreateBasketData()) }],
    );
    const indexer = new EventIndexer(rpcForTx(tx, factoryAccount), {
      programIds: [FACTORY_PROGRAM.toBase58()],
      pollIntervalMs: 1000,
      signaturesPerPoll: 10,
      maxSeenCache: 100,
    }, db as never);
    const results = await indexer.pollOnce();
    expect(results).toHaveLength(1);
    expect(results[0].events[0].type).toBe("BasketCreated");

    expect(db.calls.length).toBeGreaterThanOrEqual(3);
    const eventCall = db.calls.find((c) => c.sql.includes("INSERT INTO events"));
    expect(eventCall).toBeDefined();
    expect(eventCall?.values?.[0]).toBe("SIG1");
    expect(eventCall?.values?.[3]).toBe("BasketCreated");
    // u64-safe JSONB: nonce rides as a decimal string inside createBasket
    const dataJson = JSON.parse(eventCall?.values?.[4] as string);
    expect(dataJson.createBasket.nonce).toBe("7");
    expect(dataJson.createBasket.seedAmounts).toEqual(["500", "300"]);

    const basketCall = db.calls.find((c) => c.sql.includes("INSERT INTO baskets"));
    expect(basketCall).toBeDefined();
    expect(basketCall?.values?.[0]).toBe(pk(10).toBase58()); // basket pubkey
    expect(basketCall?.values?.[3]).toBe(pk(6).toBase58()); // treasury from FactoryConfig
    expect(basketCall?.values?.[5]).toBe("7"); // nonce bound as string -> BIGINT
    expect(basketCall?.values?.[9]).toEqual([pk(1).toBase58(), pk(2).toBase58()]);
    expect(basketCall?.values?.[10]).toEqual([6000, 4000]);
    expect(new Date(basketCall?.values?.[6] as string).toISOString()).toBe("2024-09-01T00:00:00.000Z");

    const statsCall = db.calls.find((c) => c.sql.includes("INSERT INTO creator_stats"));
    expect(statsCall).toBeDefined();
  });

  it("does not double-count when the event already existed (rowCount 0)", async () => {
    const db = fakeDb(0);
    const tx = fakeTx(
      [`Program data: ${payload.toString("base64")}`],
      [{ programId: FACTORY_PROGRAM, accounts: [pk(5), pk(10), pk(12), pk(11)], data: bs58.encode(buildCreateBasketData()) }],
    );
    const indexer = new EventIndexer(rpcForTx(tx, factoryAccount), {
      programIds: [FACTORY_PROGRAM.toBase58()],
      pollIntervalMs: 1000,
      signaturesPerPoll: 10,
      maxSeenCache: 100,
    }, db as never);
    await indexer.pollOnce();
    expect(db.calls.find((c) => c.sql.includes("INSERT INTO baskets"))).toBeUndefined();
    expect(db.calls.find((c) => c.sql.includes("creator_stats"))).toBeUndefined();
  });

  it("skips failed signatures and caches seen signatures across polls", async () => {
    const db = fakeDb(1);
    let calls = 0;
    const rpc: SolanaRpc = {
      async getSignaturesForAddress() {
        return [
          { signature: "SIG_ERR", slot: 1, err: { InstructionError: [0, 0] }, blockTime: null },
          { signature: "SIG_OK", slot: 2, err: null, blockTime: 1725148800 },
        ];
      },
      async getParsedTransaction() {
        calls++;
        return fakeTx([`Program data: ${payload.toString("base64")}`], []);
      },
      async getAccountInfo() {
        return null;
      },
    };
    const indexer = new EventIndexer(rpc, {
      programIds: [FACTORY_PROGRAM.toBase58()],
      pollIntervalMs: 1000,
      signaturesPerPoll: 10,
      maxSeenCache: 100,
    }, db as never);
    const first = await indexer.pollOnce();
    expect(first[0].signaturesSeen).toBe(1);
    expect(calls).toBe(1);
    const second = await indexer.pollOnce();
    expect(second[0].signaturesSeen).toBe(0);
    expect(calls).toBe(1); // seen cache prevented a refetch
  });

  it("works fully DB-less: decodes and returns events without persistence", async () => {
    const tx = fakeTx([`Program data: ${payload.toString("base64")}`], []);
    const indexer = new EventIndexer(rpcForTx(tx, factoryAccount), {
      programIds: [FACTORY_PROGRAM.toBase58()],
      pollIntervalMs: 1000,
      signaturesPerPoll: 10,
      maxSeenCache: 100,
    }, null);
    const results = await indexer.pollOnce();
    expect(results[0].events).toHaveLength(1);
    expect(results[0].events[0].type).toBe("BasketCreated");
  });

  it("RPC failure in pollOnce degrades to an empty result", async () => {
    const rpc: SolanaRpc = {
      async getSignaturesForAddress(): Promise<never[]> {
        throw new Error("rpc unreachable");
      },
      async getParsedTransaction() {
        return null;
      },
      async getAccountInfo() {
        return null;
      },
    };
    const indexer = new EventIndexer(rpc, {
      programIds: [FACTORY_PROGRAM.toBase58()],
      pollIntervalMs: 1000,
      signaturesPerPoll: 10,
      maxSeenCache: 100,
    }, null);
    const results = await indexer.pollOnce();
    expect(results[0].events).toHaveLength(0);
  });

  it("insertEvent / insertEvents skip writes without a db", async () => {
    const row: EventRow = {
      sig: "S", slot: 1, basket: null, type: "Minted", data: {}, ts: new Date(0),
    };
    expect(await insertEvent(null, row)).toBe(false);
    expect(await insertEvents(null, [row])).toBe(0);
  });
});

// --- 8. Schema bootstrap (db/init.ts) ----------------------------------------

describe("db/init — schema bootstrap", () => {
  it("schema.sql is the normative spec §7 shape and idempotent", () => {
    const sql = loadSchemaSql();
    expect(sql).not.toBeNull();
    const text = sql as string;
    for (const table of [
      "baskets", "whitelisted_mints", "vault_holdings", "nav_snapshots",
      "supply_snapshots", "events", "creator_stats", "user_positions",
      "providers", "price_snapshots", "index_snapshots",
    ]) {
      expect(text).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
    expect(text).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(text).toContain("CREATE MATERIALIZED VIEW IF NOT EXISTS basket_rankings");
    expect(text).toContain("CREATE OR REPLACE VIEW basket_latest_nav");
    // reserved word must be quoted
    expect(text).toContain('"user"');
    // index names for IF NOT EXISTS
    expect(text).toContain("CREATE INDEX IF NOT EXISTS nav_snapshots_basket_ts_idx");
  });

  it("applySchema runs the whole script when a client is provided", async () => {
    const db = fakeDb(0);
    expect(await applySchema(db as never)).toBe(true);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toContain("CREATE TABLE IF NOT EXISTS baskets");
    expect(db.calls[0].values).toBeUndefined(); // simple query protocol
  });

  it("applySchema and ensureSchemaFromEnv degrade honestly without Postgres", async () => {
    expect(await applySchema(null)).toBe(false);
    expect(await applySchema(undefined)).toBe(false);
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(await ensureSchemaFromEnv()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
    expect(schemaCandidates().length).toBeGreaterThan(0);
  });
});

// --- 9. priceFetch: typed response, 30s cache, source/asOf markers -----------

const FIXED_NOW = (): Date => new Date("2026-09-01T12:00:00.000Z");

function jupiterRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("workers/priceFetch — Jupiter v6 + cache + markers", () => {
  beforeEach(() => clearPriceCache());

  it("returns typed PricePoints with source 'jupiter' and asOf timestamps", async () => {
    let fetchCalls = 0;
    const fetchImpl = (async (): Promise<Response> => {
      fetchCalls++;
      return jupiterRes({
        data: {
          MINT_A: { id: "MINT_A", type: "price", price: "123.45" },
          MINT_B: { id: "MINT_B", price: 7 },
        },
      });
    }) as typeof fetch;
    const quotes = await fetchPriceQuotes(["MINT_A", "MINT_B"], { fetchImpl, now: FIXED_NOW });
    expect(fetchCalls).toBe(1);
    expect(quotes.MINT_A).toEqual({ mint: "MINT_A", price: 123.45, source: "jupiter", asOf: "2026-09-01T12:00:00.000Z" });
    expect(quotes.MINT_B.price).toBe(7);
    expect(quotes.MINT_B.source).toBe("jupiter");
  });

  it("serves identical mint sets from the 30s cache without refetching", async () => {
    let fetchCalls = 0;
    const fetchImpl = (async (): Promise<Response> => {
      fetchCalls++;
      return jupiterRes({ data: { MINT_A: { id: "MINT_A", price: "1" } } });
    }) as typeof fetch;
    await fetchPriceQuotes(["MINT_A", "MINT_B"], { fetchImpl, now: FIXED_NOW });
    // same set, different order -> cache hit
    await fetchPriceQuotes(["MINT_B", "MINT_A"], { fetchImpl, now: FIXED_NOW });
    expect(fetchCalls).toBe(1);

    // TTL expiry -> refetch
    const later = (): Date => new Date(FIXED_NOW().getTime() + PRICE_CACHE_TTL_MS + 1);
    await fetchPriceQuotes(["MINT_A", "MINT_B"], { fetchImpl, now: later });
    expect(fetchCalls).toBe(2);
  });

  it("without PRICE_FALLBACK=mock, a Jupiter outage degrades to an empty map", async () => {
    const fetchImpl = (async (): Promise<Response> => {
      throw new Error("connection refused");
    }) as typeof fetch;
    const quotes = await fetchPriceQuotes(["MINT_A"], { fetchImpl, now: FIXED_NOW, fallback: "none" });
    expect(quotes).toEqual({});
  });

  it("mock fallback exists only behind PRICE_FALLBACK=mock and is labeled source 'mock'", async () => {
    const fetchImpl = (async (): Promise<Response> => {
      throw new Error("connection refused");
    }) as typeof fetch;
    const quotes = await fetchPriceQuotes(["MINT_A", "MINT_B"], { fetchImpl, now: FIXED_NOW, fallback: "mock" });
    expect(quotes.MINT_A).toEqual({ mint: "MINT_A", price: 0, source: "mock", asOf: "2026-09-01T12:00:00.000Z" });
    expect(quotes.MINT_B.source).toBe("mock");

    // env-driven opt-in
    clearPriceCache();
    const saved = process.env.PRICE_FALLBACK;
    process.env.PRICE_FALLBACK = "mock";
    try {
      const viaEnv = await fetchPriceQuotes(["MINT_C"], { fetchImpl, now: FIXED_NOW });
      expect(viaEnv.MINT_C.source).toBe("mock");
    } finally {
      if (saved === undefined) delete process.env.PRICE_FALLBACK;
      else process.env.PRICE_FALLBACK = saved;
    }
  });

  it("fills only missing mints with mock when Jupiter partially responds", async () => {
    clearPriceCache();
    const fetchImpl = (async (): Promise<Response> =>
      jupiterRes({ data: { MINT_A: { id: "MINT_A", price: "50" } } })) as typeof fetch;
    const quotes = await fetchPriceQuotes(["MINT_A", "MINT_B"], { fetchImpl, now: FIXED_NOW, fallback: "mock" });
    expect(quotes.MINT_A.source).toBe("jupiter");
    expect(quotes.MINT_B.source).toBe("mock");
  });

  it("legacy fetchPrices keeps the numeric map contract (missing -> 0)", async () => {
    clearPriceCache();
    const fetchImpl = (async (): Promise<Response> =>
      jupiterRes({ data: { MINT_A: { id: "MINT_A", price: "123.45" } } })) as typeof fetch;
    const map = await fetchPrices(["MINT_A", "MINT_MISSING"], { fetchImpl, now: FIXED_NOW });
    expect(map.MINT_A).toBe(123.45);
    expect(map.MINT_MISSING).toBe(0);
  });

  it("rejects malformed Jupiter payloads instead of trusting them", async () => {
    clearPriceCache();
    const fetchImpl = (async (): Promise<Response> => jupiterRes({ data: "not-an-object" })) as typeof fetch;
    const quotes = await fetchPriceQuotes(["MINT_A"], { fetchImpl, now: FIXED_NOW, fallback: "none" });
    expect(quotes).toEqual({});
  });

  it("mockPriceQuotes marks every price as mock with asOf; mockPrices unchanged", () => {
    const quotes = mockPriceQuotes(["A"], 12, FIXED_NOW);
    expect(quotes.A).toEqual({ mint: "A", price: 12, source: "mock", asOf: "2026-09-01T12:00:00.000Z" });
    expect(mockPrices(["x", "y"], 5)).toEqual({ x: 5, y: 5 });
    expect(mockPrices(["z"])).toEqual({ z: 100 });
  });
});
