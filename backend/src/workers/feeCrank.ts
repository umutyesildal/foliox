/**
 * workers/feeCrank.ts — management-fee accrual crank (spec §7 queue
 * `fee_accrue_crank`, hourly; programs/basket accrue_management_fee).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HARD CONSTRAINT (AGENTS.md §2 #5): the backend NEVER custodies, NEVER holds
 * keys, NEVER signs and NEVER submits. This crank only BUILDS unsigned
 * `accrue_management_fee` transactions (base64 + a human-readable instruction
 * descriptor list) for baskets whose last accrual is more than an hour old and
 * logs/returns them. A permissionless keeper/wallet picks the base64 up and
 * signs + submits it. `accrue_management_fee` itself is permissionless —
 * anyone may crank; the payer only covers ATA rent.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Account layout mirrors `AccrueFee<'info>` (programs/basket/src/lib.rs:949):
 *   0 basket                (mut)
 *   1 share_mint            (mut)
 *   2 payer                 (signer, mut) — the keeper wallet
 *   3 vault_authority       PDA ["basket", basket] — signs fee mint_to on-chain
 *   4 creator               (== basket.creator)
 *   5 creator_share_ata     (mut) ATA(creator, share_mint)
 *   6 treasury              (== basket.treasury)
 *   7 treasury_share_ata    (mut) ATA(treasury, share_mint)
 *   8 token_program         (Token-2022 — share mints are Token-2022)
 *   9 associated_token_program
 *  10 system_program
 *
 * Degradation: no DB → no-op with reason; no RPC → instruction descriptors
 * are still built but `transactionBase64` is null (no blockhash — an unsigned
 * tx without a fresh blockhash would be a lie).
 */
import {
  Connection,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  PublicKey,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { anchorIxDiscriminator } from "../indexer/events.js";
import { isPgLike, type PgLike } from "../db/client.js";

export const BASKET_PROGRAM_ID = "37VPGtd57kXJ1HvH1xvdZr1y3s4KXj9pP2o6GdYLgbb1"; // programs/basket/src/lib.rs:4
export const FEE_CRANK_INTERVAL_MS = 3_600_000; // hourly — spec §7 fee_accrue_crank
export const FEE_ACCRUE_MIN_ELAPSED_SEC = 3600; // baskets with elapsed > 1h
const SECONDS_PER_YEAR = 31_536_000n;
const BPS_DENOM = 10_000n;

/** Structural slice of @solana/web3.js Connection used for the blockhash. */
export interface BlockhashRpc {
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
}

export interface FeeIxAccount {
  name: string;
  pubkey: string;
  signer: boolean;
  writable: boolean;
}

export interface FeeIxDescriptor {
  programId: string;
  name: "accrue_management_fee";
  discriminatorBase58: string; // Anchor 8-byte discriminator (bs58 of the bytes)
  accounts: FeeIxAccount[];
}

export interface BuiltFeeTx {
  basket: string;
  shareMint: string;
  creator: string;
  treasury: string;
  managementFeeBps: number;
  elapsedSec: number;
  /** floor(supply × bps × elapsed / (10000 × 31536000)) — estimate only; the
   *  on-chain value is recomputed by the program from actual state. */
  estimatedFeeShares: string | null;
  /** UNSIGNED versioned transaction, base64 — null when no RPC (no blockhash). */
  transactionBase64: string | null;
  /** Signatures are ALWAYS empty: this backend never signs. */
  signatures: number;
  instructions: FeeIxDescriptor[];
  feePayer: string;
  blockhash: string | null;
  lastValidBlockHeight: number | null;
  note: string;
}

export interface FeeCrankRun {
  eligible: number;
  built: BuiltFeeTx[];
  failed: Array<{ basket: string; error: string }>;
  reason?: string; // set when the pass was skipped (e.g. "no-db")
}

export interface FeeCrankDeps {
  db: PgLike | null;
  /** RPC for fresh blockhashes — optional; null degrades to descriptor-only. */
  rpc?: BlockhashRpc | null;
  /** Keeper wallet pubkey that will sign (becomes the tx feePayer / payer). */
  keeperPubkey?: string | null;
  now?: () => Date;
  intervalMs?: number;
  limit?: number;
  log?: (msg: string) => void;
}

export class FeeCrank {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly deps: FeeCrankDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const interval = this.deps.intervalMs ?? FEE_CRANK_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.runOnce().catch((err) => {
        console.warn("[feeCrank] runOnce failed:", err instanceof Error ? err.message : err);
      });
    }, interval);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One pass: find baskets with last_fee_accrual_ts older than 1h, BUILD the
   * unsigned accrue_management_fee tx for each, log + return. The backend
   * never signs and never submits (AGENTS.md §2 #5).
   */
  async runOnce(): Promise<FeeCrankRun> {
    const db = this.deps.db;
    const run: FeeCrankRun = { eligible: 0, built: [], failed: [] };
    if (!isPgLike(db)) {
      run.reason = "no-db";
      return run;
    }

    let rows: Array<{
      pubkey: string;
      share_mint: string;
      creator: string;
      treasury: string;
      management_fee_bps: number;
      elapsed_sec: number;
      supply: string | null;
    }>;
    try {
      const res = await db.query(
        `SELECT b.pubkey, b.share_mint, b.creator, b.treasury, b.management_fee_bps,
                EXTRACT(EPOCH FROM (NOW() - b.last_fee_accrual_ts))::float8 AS elapsed_sec,
                (SELECT supply::text FROM nav_snapshots s WHERE s.basket = b.pubkey
                 ORDER BY ts DESC LIMIT 1) AS supply
         FROM baskets b
         WHERE b.last_fee_accrual_ts <= NOW() - make_interval(secs => $1)
         ORDER BY b.last_fee_accrual_ts ASC
         LIMIT $2`,
        [FEE_ACCRUE_MIN_ELAPSED_SEC, this.deps.limit ?? 100],
      );
      rows = res.rows as typeof rows;
    } catch (err) {
      run.reason = `eligible query failed: ${err instanceof Error ? err.message : err}`;
      return run;
    }

    run.eligible = rows.length;
    for (const row of rows) {
      try {
        const built = await this.buildFeeTx(row);
        run.built.push(built);
        this.deps.log?.(
          `[feeCrank] BUILT unsigned accrue_management_fee for ${row.pubkey} ` +
            `(elapsed ${Math.floor(row.elapsed_sec)}s, est. fee ${built.estimatedFeeShares ?? "?"} shares) — ` +
            `keeper must sign+submit; backend never signs`,
        );
      } catch (err) {
        run.failed.push({
          basket: row.pubkey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return run;
  }

  /**
   * Build ONE unsigned accrue_management_fee transaction for a basket.
   * Exposed separately for tests and for keeper tooling.
   */
  async buildFeeTx(row: {
    pubkey: string;
    share_mint: string;
    creator: string;
    treasury: string;
    management_fee_bps: number;
    elapsed_sec: number;
    supply: string | null;
  }): Promise<BuiltFeeTx> {
    const basketPk = new PublicKey(row.pubkey);
    const shareMintPk = new PublicKey(row.share_mint);
    const creatorPk = new PublicKey(row.creator);
    const treasuryPk = new PublicKey(row.treasury);

    const vaultAuthority = PublicKey.findProgramAddressSync(
      [Buffer.from("basket"), basketPk.toBuffer()],
      new PublicKey(BASKET_PROGRAM_ID),
    )[0];
    const creatorShareAta = getAssociatedTokenAddressSync(
      shareMintPk,
      creatorPk,
      true,
      TOKEN_2022_PROGRAM_ID,
    );
    const treasuryShareAta = getAssociatedTokenAddressSync(
      shareMintPk,
      treasuryPk,
      true,
      TOKEN_2022_PROGRAM_ID,
    );

    const keeper = this.deps.keeperPubkey
      ? new PublicKey(this.deps.keeperPubkey)
      : PublicKey.default; // placeholder — keeperPubkey should be configured

    const accounts: FeeIxAccount[] = [
      { name: "basket", pubkey: basketPk.toBase58(), signer: false, writable: true },
      { name: "share_mint", pubkey: shareMintPk.toBase58(), signer: false, writable: true },
      { name: "payer", pubkey: keeper.toBase58(), signer: true, writable: true },
      { name: "vault_authority", pubkey: vaultAuthority.toBase58(), signer: false, writable: false },
      { name: "creator", pubkey: creatorPk.toBase58(), signer: false, writable: false },
      { name: "creator_share_ata", pubkey: creatorShareAta.toBase58(), signer: false, writable: true },
      { name: "treasury", pubkey: treasuryPk.toBase58(), signer: false, writable: false },
      { name: "treasury_share_ata", pubkey: treasuryShareAta.toBase58(), signer: false, writable: true },
      { name: "token_program", pubkey: TOKEN_2022_PROGRAM_ID.toBase58(), signer: false, writable: false },
      { name: "associated_token_program", pubkey: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), signer: false, writable: false },
      { name: "system_program", pubkey: SystemProgram.programId.toBase58(), signer: false, writable: false },
    ];

    const ix = new TransactionInstruction({
      programId: new PublicKey(BASKET_PROGRAM_ID),
      keys: accounts.map((a) => ({
        pubkey: new PublicKey(a.pubkey),
        isSigner: a.signer,
        isWritable: a.writable,
      })),
      data: anchorIxDiscriminator("accrue_management_fee"),
    });

    const descriptor: FeeIxDescriptor = {
      programId: BASKET_PROGRAM_ID,
      name: "accrue_management_fee",
      discriminatorBase58: Buffer.from(ix.data).toString("hex"),
      accounts,
    };

    let transactionBase64: string | null = null;
    let blockhash: string | null = null;
    let lastValidBlockHeight: number | null = null;
    if (this.deps.rpc) {
      const bh = await this.deps.rpc.getLatestBlockhash();
      blockhash = bh.blockhash;
      lastValidBlockHeight = bh.lastValidBlockHeight;
      // UNSIGNED versioned tx: signatures stay EMPTY — nothing here can sign
      // (no key material exists in this process by construction).
      const message = new TransactionMessage({
        payerKey: keeper,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message();
      const vtx = new VersionedTransaction(message);
      transactionBase64 = Buffer.from(vtx.serialize()).toString("base64");
    }

    const elapsedSec = Math.max(0, Math.floor(row.elapsed_sec));
    const estimatedFeeShares =
      row.supply && BigInt(row.supply) > 0n
        ? (BigInt(row.supply) * BigInt(row.management_fee_bps) * BigInt(elapsedSec) /
            (BPS_DENOM * SECONDS_PER_YEAR)).toString()
        : null;

    const note =
      "UNSIGNED accrue_management_fee tx built by the FolioX backend for a " +
      "permissionless keeper. The backend never custodies, never signs and " +
      "never submits (AGENTS.md §2 #5): decode the base64 as a " +
      "VersionedTransaction, sign with the keeper wallet (feePayer) and submit. " +
      "accrue_management_fee is permissionless — any wallet may crank.";

    return {
      basket: row.pubkey,
      shareMint: row.share_mint,
      creator: row.creator,
      treasury: row.treasury,
      managementFeeBps: row.management_fee_bps,
      elapsedSec,
      estimatedFeeShares,
      transactionBase64,
      signatures: 0,
      instructions: [descriptor],
      feePayer: keeper.toBase58(),
      blockhash,
      lastValidBlockHeight,
      note,
    };
  }
}

/** Legacy helper kept for parity with the V0 crank sketch (pure math). */
export function estimateManagementFeeShares(
  supply: string | number,
  managementFeeBps: number,
  elapsedSec: number,
): string {
  const s = typeof supply === "number" ? BigInt(Math.max(0, Math.floor(supply))) : BigInt(supply);
  const elapsed = BigInt(Math.max(0, Math.floor(elapsedSec)));
  return ((s * BigInt(managementFeeBps) * elapsed) / (BPS_DENOM * SECONDS_PER_YEAR)).toString();
}

/**
 * Env-gated factory: the crank needs a DB (basket rows). RPC is optional —
 * without it transactions come back descriptor-only (transactionBase64 null).
 * FEE_CRANK=0 forces the crank off. Cadence: FEE_CRANK_MS or hourly.
 */
export function createFeeCrankFromEnv(opts: {
  db: PgLike | null;
  env?: NodeJS.ProcessEnv;
  rpc?: BlockhashRpc | null;
}): FeeCrank | null {  const env = opts.env ?? process.env;
  if (env.FEE_CRANK === "0") {
    console.warn("[feeCrank] disabled by FEE_CRANK=0");
    return null;
  }
  if (!isPgLike(opts.db)) {
    console.warn("[feeCrank] disabled — no Postgres (DB-less mode)");
    return null;
  }
  let rpc: BlockhashRpc | null = opts.rpc ?? null;
  const rpcUrl = env.RPC_URL;
  if (!rpc && rpcUrl) {
    const conn = new Connection(rpcUrl);
    rpc = {
      getLatestBlockhash: () => conn.getLatestBlockhash(),
    };
  }
  const intervalMs = Number(env.FEE_CRANK_MS || FEE_CRANK_INTERVAL_MS);
  const keeperPubkey = env.FEE_CRANK_PAYER_PUBKEY ?? null;
  if (!keeperPubkey) {
    console.warn("[feeCrank] FEE_CRANK_PAYER_PUBKEY unset — built txs use a placeholder feePayer");
  }
  console.log(`[feeCrank] enabled (interval ${intervalMs}ms) — builds UNSIGNED txs only, backend never signs`);
  return new FeeCrank({ db: opts.db, rpc, keeperPubkey, intervalMs });
}
