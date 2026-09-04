/**
 * livewire.test.ts — devnet live-indexing regression tests.
 *
 * Pins the three fixes that make a fresh backend sync the real devnet state:
 *   1. listener ordering — the baskets row is upserted BEFORE the events rows
 *      (events.basket carries a FK to baskets(pubkey)); a fresh sync used to
 *      fail every event insert with events_basket_fkey and drop signatures.
 *   2. listener retry — a signature whose processing throws (devnet 429s, FK
 *      waits) is retried on the next poll instead of being markSeen-dropped.
 *   3. whitelistSync — on-chain WhitelistedMint accounts decode into
 *      whitelisted_mints rows with their on-chain price_source labels.
 * All fixtures are hand-built bytes, no live RPC.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { PublicKey, type AccountInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import bs58 from "bs58";

import {
  ANCHOR_EVENT_DISCRIMINATORS,
  CREATE_BASKET_IX_DISCRIMINATOR,
} from "../src/indexer/events";
import { EventIndexer, type SolanaRpc } from "../src/indexer/listener";
import {
  decodeWhitelistedMint,
  syncWhitelistedMints,
  whitelistedMintDiscriminator,
  type WhitelistRpc,
} from "../src/indexer/whitelistSync";
import { deriveBasketPda, deriveVaultAuthority, getVaultAtas } from "../src/indexer/holdingsSync";

const pk = (n: number): PublicKey => new PublicKey(Buffer.alloc(32, n));

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
const sha8 = (input: string): Buffer =>
  createHash("sha256").update(input).digest().subarray(0, 8);

const FACTORY_PROGRAM = new PublicKey("3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF");

function buildCreateBasketData(): Buffer {
  return Buffer.concat([
    CREATE_BASKET_IX_DISCRIMINATOR,
    u64le(7n),
    u32le(2), ...[pk(1), pk(2)].map((k) => k.toBuffer()),
    u32le(2), Buffer.from([0x70, 0x17]), Buffer.from([0xa0, 0x0f]),
    Buffer.from([100, 0]), Buffer.from([50, 0]), Buffer.from([200, 0]),
    Buffer.alloc(32, 7),
    u32le(2), u64le(500n), u64le(300n),
  ]);
}

function buildBasketCreatedPayload(): Buffer {
  return Buffer.concat([
    ANCHOR_EVENT_DISCRIMINATORS.BasketCreated,
    pk(10).toBuffer(),
    pk(11).toBuffer(),
    Buffer.from([2]),
    pk(12).toBuffer(),
    i64le(1725148800n),
  ]);
}

function fakeTx(logs: string[], ixs: Array<{ programId: PublicKey; accounts: PublicKey[]; data: string }>): ParsedTransactionWithMeta {
  return {
    transaction: { message: { instructions: ixs } },
    meta: { logMessages: logs, innerInstructions: [], slot: 42 },
  } as unknown as ParsedTransactionWithMeta;
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

const cfg = {
  programIds: [FACTORY_PROGRAM.toBase58()],
  pollIntervalMs: 1000,
  signaturesPerPoll: 10,
  maxSeenCache: 100,
};

const factoryAccount = Buffer.concat([Buffer.alloc(8), pk(5).toBuffer(), pk(6).toBuffer()]);

// --- 1. listener ordering: baskets row lands BEFORE events rows --------------

describe("listener — baskets-before-events ordering (FK fix)", () => {
  it("upserts the baskets row before inserting the event rows", async () => {
    const db = fakeDb(1);
    const tx = fakeTx(
      [`Program data: ${payloadBase64()}`],
      [{ programId: FACTORY_PROGRAM, accounts: [pk(5), pk(10), pk(12), pk(11)], data: bs58.encode(buildCreateBasketData()) }],
    );
    const indexer = new EventIndexer(rpcForTx(tx, factoryAccount), cfg, db as never);
    await indexer.pollOnce();
    const basketIdx = db.calls.findIndex((c) => c.sql.includes("INSERT INTO baskets"));
    const eventIdx = db.calls.findIndex((c) => c.sql.includes("INSERT INTO events"));
    expect(basketIdx).toBeGreaterThanOrEqual(0);
    expect(eventIdx).toBeGreaterThanOrEqual(0);
    expect(basketIdx).toBeLessThan(eventIdx);
  });

  function payloadBase64(): string {
    return buildBasketCreatedPayload().toString("base64");
  }

  function rpcForTx(tx: ParsedTransactionWithMeta, factoryAcct: Buffer): SolanaRpc {
    return {
      async getSignaturesForAddress() {
        return [{ signature: "SIG1", slot: 42, err: null, blockTime: 1725148800 }];
      },
      async getParsedTransaction() {
        return tx;
      },
      async getAccountInfo() {
        return accountInfo(FACTORY_PROGRAM, factoryAcct);
      },
    };
  }
});

// --- 2. listener retry: failed signatures are retried, not dropped -----------

describe("listener — retry on processing failure", () => {
  it("retries a signature whose transaction fetch throws, then caches it", async () => {
    const db = fakeDb(1);
    let fetches = 0;
    const tx = fakeTx(
      [`Program data: ${buildBasketCreatedPayload().toString("base64")}`],
      [{ programId: FACTORY_PROGRAM, accounts: [pk(5), pk(10), pk(12), pk(11)], data: bs58.encode(buildCreateBasketData()) }],
    );
    const rpc: SolanaRpc = {
      async getSignaturesForAddress() {
        return [{ signature: "SIG429", slot: 1, err: null, blockTime: 1725148800 }];
      },
      async getParsedTransaction() {
        fetches++;
        if (fetches === 1) throw new Error("429 Too Many Requests");
        return tx;
      },
      async getAccountInfo() {
        return accountInfo(FACTORY_PROGRAM, factoryAccount);
      },
    };
    const indexer = new EventIndexer(rpc, cfg, db as never);
    const first = await indexer.pollOnce(); // throws → sig left unseen
    expect(first[0].events).toHaveLength(0);
    expect(fetches).toBe(1);

    const second = await indexer.pollOnce(); // retried and lands
    expect(second[0].events).toHaveLength(1);
    expect(fetches).toBe(2);
    expect(db.calls.find((c) => c.sql.includes("INSERT INTO baskets"))).toBeDefined();

    await indexer.pollOnce(); // seen cache prevents a third fetch
    expect(fetches).toBe(2);
  });
});

// --- 4. PDA derivations: pinned to the REAL devnet addresses -----------------

describe("holdingsSync — devnet PDA derivations", () => {
  const FACTORY = "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF";
  const factory = "CfxquMe4MAPksEEsVyw8XmcxYH5W7qftRWNySgHjLi6e";
  const creator = "y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE";

  it("derives the basket PDA under the FACTORY program id (devnet basket)", () => {
    const pda = deriveBasketPda(new PublicKey(factory), new PublicKey(creator), "0");
    expect(pda.toBase58()).toBe("9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg");
    // Derivation program id matters: the same seeds under the basket program
    // give a different address (the bug this pins against).
    const wrong = PublicKey.findProgramAddressSync(
      [Buffer.from("basket"), new PublicKey(factory).toBuffer(), new PublicKey(creator).toBuffer(), Buffer.alloc(8)],
      new PublicKey("6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k"),
    )[0];
    expect(wrong.toBase58()).not.toBe(pda.toBase58());
    expect(FACTORY).toHaveLength(44); // keep the literal checked
  });

  it("derives the vault authority under the BASKET program id (devnet vault)", () => {
    const basket = new PublicKey("9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg");
    expect(deriveVaultAuthority(basket).toBase58()).toBe(
      "9Eh9i7Uru8kaZ8zqxY5cpiE11fVDHU8APYSXM7ThLn8b",
    );
    const atas = getVaultAtas(basket, [pk(3)]);
    expect(atas).toHaveLength(1);
    expect(atas[0].toBase58()).not.toBe(basket.toBase58());
  });
});

// --- 3. whitelistSync: on-chain WhitelistedMint → whitelisted_mints ----------

function buildWhitelistedMintAccount(
  mint: PublicKey,
  decimals: number,
  statusRaw: number,
  priceSource: string,
): Buffer {
  return Buffer.concat([
    whitelistedMintDiscriminator(),
    mint.toBuffer(),
    Buffer.from([decimals]),
    u64le(1_000_000n),
    Buffer.from([statusRaw]),
    u32le(Buffer.byteLength(priceSource, "utf8")),
    Buffer.from(priceSource, "utf8"),
    Buffer.from([255]),
  ]);
}

describe("whitelistSync — WhitelistedMint account decoding", () => {
  it("decodes mint / decimals / status / price_source", () => {
    const data = buildWhitelistedMintAccount(pk(3), 6, 0, "mock:tsla");
    const decoded = decodeWhitelistedMint(data);
    expect(decoded).not.toBeNull();
    expect(decoded?.mint).toBe(pk(3).toBase58());
    expect(decoded?.decimals).toBe(6);
    expect(decoded?.statusRaw).toBe(0);
    expect(decoded?.status).toBe("Active");
    expect(decoded?.priceSource).toBe("mock:tsla");
  });

  it("maps PausedNewMints and leaves unknown status bytes unmapped", () => {
    const paused = decodeWhitelistedMint(buildWhitelistedMintAccount(pk(4), 8, 1, "jupiter:TSLAx"));
    expect(paused?.status).toBe("PausedNewMints");
    const unknown = decodeWhitelistedMint(buildWhitelistedMintAccount(pk(5), 8, 7, "x"));
    expect(unknown?.statusRaw).toBe(7);
    expect(unknown?.status).toBeUndefined();
  });

  it("rejects wrong discriminator / truncated payloads", () => {
    const good = buildWhitelistedMintAccount(pk(6), 6, 0, "mock:nvda");
    const wrongDisc = Buffer.from(good);
    sha8("account:SomethingElse").copy(wrongDisc, 0);
    expect(decodeWhitelistedMint(wrongDisc)).toBeNull();
    expect(decodeWhitelistedMint(good.subarray(0, 30))).toBeNull();
    expect(decodeWhitelistedMint(Buffer.alloc(0))).toBeNull();
  });
});

describe("whitelistSync — program account sweep", () => {
  it("upserts valid rows and skips unknown status bytes", async () => {
    const db = fakeDb(1);
    const accounts = [
      { pubkey: pk(1), account: accountInfo(new PublicKey("FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS"), buildWhitelistedMintAccount(pk(1), 6, 0, "mock:nvda")) },
      { pubkey: pk(2), account: accountInfo(new PublicKey("FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS"), buildWhitelistedMintAccount(pk(2), 6, 99, "bogus")) },
    ];
    const rpc: WhitelistRpc = {
      async getProgramAccounts() {
        return accounts;
      },
    };
    const n = await syncWhitelistedMints(rpc, "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS", db as never);
    expect(n).toBe(1);
    const call = db.calls.find((c) => c.sql.includes("INSERT INTO whitelisted_mints"));
    expect(call).toBeDefined();
    expect(call?.values?.[0]).toBe(pk(1).toBase58());
    expect(call?.values?.[1]).toBe(6);
    expect(call?.values?.[2]).toBe("Active");
    expect(call?.values?.[3]).toBe("mock:nvda");
  });
});
