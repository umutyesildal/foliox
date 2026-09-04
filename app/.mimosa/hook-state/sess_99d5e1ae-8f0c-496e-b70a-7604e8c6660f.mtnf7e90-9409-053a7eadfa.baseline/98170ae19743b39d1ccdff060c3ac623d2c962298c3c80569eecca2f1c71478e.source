/**
 * Client-side Anchor instruction builder for `basket_factory::create_basket`.
 *
 * Mirrors programs/basket_factory/src/lib.rs (Wave B source of truth) WITHOUT
 * adding @coral-xyz/anchor as a dependency: the 8-byte Anchor discriminator and
 * borsh argument layout are assembled by hand and verified against the Rust
 * context order.
 *
 * Program context (`CreateBasket<'info>`, basket_factory/src/lib.rs:470) —
 * named accounts, IN THIS ORDER:
 *   1. factory          PDA [b"factory"]                       (writable)
 *   2. basket           PDA [b"basket", factory, creator, nonce_le] (writable, init)
 *   3. share_mint       PDA [b"share_mint", basket]            (writable, init)
 *      — Token-2022 mint, 6 decimals, temporary authority = factory
 *   4. vault_authority  PDA [b"basket", basket] under the BASKET program id
 *      (NOT the factory id — basket_factory/src/lib.rs:446)  (read-only)
 *   5. creator_share_ata  ATA(creator, share_mint, Token-2022) (writable)
 *   6. creator          Signer                                 (writable + signer)
 *   7. token_program    = Token-2022 program id                (read-only)
 *   8. associated_token_program                                (read-only)
 *   9. system_program                                          (read-only)
 *
 * remaining_accounts — per constituent i, IN `constituents` ORDER (4 each,
 * basket_factory/src/lib.rs:30-32):
 *   [WhitelistedMint PDA (b"mint", mint) under the WHITELIST program id,
 *    mint, creator_ata (writable), vault_ata (writable)]
 *   vault_ata = ATA(vault_authority, mint, Token-2022).
 *
 * Args (borsh, basket_factory/src/lib.rs:64-73):
 *   nonce: u64, constituents: Vec<Pubkey>, weights_bps: Vec<u16>,
 *   entry_fee_bps: u16, exit_fee_bps: u16, management_fee_bps: u16,
 *   metadata_hash: [u8;32], seed_amounts: Vec<u64>
 *
 * Validation mirrors (client-side pre-checks; the program re-validates):
 *   2-20 constituents, no duplicates, sum(weights) == 10_000,
 *   fees <= 300/100/300, seed_amounts[i] > 0, metadata_hash != [0;32].
 */

import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";

import { PROGRAMS } from "@/lib/solana";

/** Anchor discriminator: first 8 bytes of sha256("global:create_basket"). */
const CREATE_BASKET_DISCRIMINATOR = Uint8Array.from([
  47, 105, 155, 148, 15, 169, 202, 211,
]);

export const FACTORY_SEED = "factory";
export const BASKET_SEED = "basket";
export const SHARE_MINT_SEED = "share_mint";
export const WHITELIST_MINT_SEED = "mint";

/** Caps enforced by FactoryConfig at init (basket_factory/src/lib.rs:48-50). */
export const ENTRY_FEE_CAP_BPS = 300;
export const EXIT_FEE_CAP_BPS = 100;
export const MANAGEMENT_FEE_CAP_BPS = 300;
export const WEIGHTS_DENOMINATOR = 10_000;
export const MIN_CONSTITUENTS = 2;
export const MAX_CONSTITUENTS = 20;
/** Genesis share supply minted to the creator (basket::GENESIS_SHARES). */
export const GENESIS_SHARES = 1_000_000;
export const SHARE_MINT_DECIMALS = 6;
/**
 * Compute units `create_basket` needs: the atomic deploy (share-mint init +
 * basket init CPI + per-constituent vault ATAs + raw seed transfers + genesis
 * mint + mint-authority handoff) exceeds the 200k default per-instruction
 * budget on localnet. Prepend this to the transaction carrying
 * `buildCreateBasketInstruction`.
 */
export const CREATE_BASKET_COMPUTE_UNITS = 500_000;

/** SetComputeUnitLimit instruction for the create_basket transaction. */
export function createBasketComputeLimitInstruction(
  units: number = CREATE_BASKET_COMPUTE_UNITS,
): TransactionInstruction {
  return ComputeBudgetProgram.setComputeUnitLimit({ units });
}

const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export interface CreateBasketArgs {
  nonce: number;
  /** Constituent mint pubkeys, base58. Order defines weights/seed order. */
  constituents: string[];
  /** Basis points per constituent, must sum to exactly 10_000. */
  weightsBps: number[];
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  /** 32-byte metadata hash (sha256 of the metadata JSON blob). */
  metadataHash: Uint8Array;
  /** Raw Token-2022 amounts per constituent, > 0. */
  seedAmounts: (number | bigint)[];
}

export interface CreateBasketAccounts {
  /** Base58 creator wallet — the transaction signer and seed funder. */
  creator: string;
}

export interface ResolvedCreateBasketPdas {
  factory: PublicKey;
  basket: PublicKey;
  shareMint: PublicKey;
  vaultAuthority: PublicKey;
  creatorShareAta: PublicKey;
  /** WhitelistedMint PDA per constituent (same order as `constituents`). */
  whitelistedMints: PublicKey[];
  /** Creator constituent ATAs (same order as `constituents`). */
  creatorAtas: PublicKey[];
  /** Vault ATAs, owned by the basket program's vault authority PDA. */
  vaultAtas: PublicKey[];
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function u16Le(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32Le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64Le(value: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** ATA of (owner, mint) under the Token-2022 program. */
export function associatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), mint.toBytes(), ASSOCIATED_TOKEN_PROGRAM_ID.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

/**
 * Derive every PDA the instruction touches. Basket PDA seeds include the
 * nonce's little-endian u64 — `deriveCreateBasketPdas` vs the program agree
 * only for the same nonce.
 */
export function deriveCreateBasketPdas(
  creator: string,
  args: Pick<
    CreateBasketArgs,
    "nonce" | "constituents"
  >,
): ResolvedCreateBasketPdas {
  const creatorKey = new PublicKey(creator);
  const nonceLe = u64Le(args.nonce);
  const constituentKeys = args.constituents.map((m) => new PublicKey(m));

  const factory = PublicKey.findProgramAddressSync(
    [utf8(FACTORY_SEED)],
    PROGRAMS.factory,
  )[0];
  const basket = PublicKey.findProgramAddressSync(
    [utf8(BASKET_SEED), factory.toBytes(), creatorKey.toBytes(), nonceLe],
    PROGRAMS.factory,
  )[0];
  const shareMint = PublicKey.findProgramAddressSync(
    [utf8(SHARE_MINT_SEED), basket.toBytes()],
    PROGRAMS.factory,
  )[0];
  // Vault authority is derived under the BASKET program id, not the factory's
  // (basket_factory/src/lib.rs:100-106, 443-448).
  const vaultAuthority = PublicKey.findProgramAddressSync(
    [utf8(BASKET_SEED), basket.toBytes()],
    PROGRAMS.basket,
  )[0];

  const whitelistedMints = constituentKeys.map((mint) =>
    PublicKey.findProgramAddressSync(
      [utf8(WHITELIST_MINT_SEED), mint.toBytes()],
      PROGRAMS.whitelist,
    )[0],
  );
  const creatorAtas = constituentKeys.map((mint) =>
    associatedTokenAddress(creatorKey, mint),
  );
  const vaultAtas = constituentKeys.map((mint) =>
    associatedTokenAddress(vaultAuthority, mint),
  );

  return {
    factory,
    basket,
    shareMint,
    vaultAuthority,
    creatorShareAta: associatedTokenAddress(creatorKey, shareMint),
    whitelistedMints,
    creatorAtas,
    vaultAtas,
  };
}

export interface CreateBasketAccountListEntry {
  role: string;
  pubkey: string;
  writable: boolean;
  signer: boolean;
  /** Optional note rendered in the review modal. */
  note?: string;
}

/**
 * Flat account list in exact instruction order (named accounts first, then the
 * per-constituent remaining_accounts groups). Used by the deploy review modal
 * so every account the transaction touches is visible before signing.
 */
export function listCreateBasketAccounts(
  creator: string,
  args: CreateBasketArgs,
  tickers?: string[],
): CreateBasketAccountListEntry[] {
  const pda = deriveCreateBasketPdas(creator, args);
  const entries: CreateBasketAccountListEntry[] = [
    { role: "factory", pubkey: pda.factory.toBase58(), writable: true, signer: false, note: "PDA [\"factory\"] — basket_count increments" },
    { role: "basket", pubkey: pda.basket.toBase58(), writable: true, signer: false, note: "PDA [\"basket\", factory, creator, nonce_le] — initialized immutable" },
    { role: "share_mint", pubkey: pda.shareMint.toBase58(), writable: true, signer: false, note: "PDA [\"share_mint\", basket] — Token-2022, 6 decimals" },
    { role: "vault_authority", pubkey: pda.vaultAuthority.toBase58(), writable: false, signer: false, note: "PDA [\"basket\", basket] under the basket program id" },
    { role: "creator_share_ata", pubkey: pda.creatorShareAta.toBase58(), writable: true, signer: false, note: "Receives the 1,000,000 genesis shares" },
    { role: "creator", pubkey: new PublicKey(creator).toBase58(), writable: true, signer: true, note: "Signer, pays rent and seeds" },
    { role: "token_program", pubkey: TOKEN_2022_PROGRAM_ID.toBase58(), writable: false, signer: false, note: "Token-2022 only" },
    { role: "associated_token_program", pubkey: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), writable: false, signer: false },
    { role: "system_program", pubkey: PublicKey.default.toBase58(), writable: false, signer: false },
  ];
  args.constituents.forEach((mint, i) => {
    const label = tickers?.[i] ? ` (${tickers[i]})` : "";
    entries.push({ role: `whitelisted_mint[${i}]${label}`, pubkey: pda.whitelistedMints[i].toBase58(), writable: false, signer: false, note: "PDA [\"mint\", mint] under the whitelist program" });
    entries.push({ role: `mint[${i}]${label}`, pubkey: mint, writable: false, signer: false });
    entries.push({ role: `creator_ata[${i}]${label}`, pubkey: pda.creatorAtas[i].toBase58(), writable: true, signer: false, note: "Seed source" });
    entries.push({ role: `vault_ata[${i}]${label}`, pubkey: pda.vaultAtas[i].toBase58(), writable: true, signer: false, note: "Created idempotently, receives the raw seed" });
  });
  return entries;
}

/** Client-side mirror of the factory's pure validations (spec §3.2). */
export function validateCreateBasketArgs(args: CreateBasketArgs): string[] {
  const errors: string[] = [];
  const n = args.constituents.length;
  if (args.weightsBps.length !== n || args.seedAmounts.length !== n) {
    errors.push("Constituents, weights and seed amounts must have the same length.");
    return errors;
  }
  if (n < MIN_CONSTITUENTS || n > MAX_CONSTITUENTS) {
    errors.push(`A basket needs ${MIN_CONSTITUENTS}-${MAX_CONSTITUENTS} constituents (got ${n}).`);
  }
  const seen = new Set<string>();
  for (const mint of args.constituents) {
    if (seen.has(mint)) errors.push("Duplicate constituent mint.");
    seen.add(mint);
  }
  const sum = args.weightsBps.reduce((a, b) => a + b, 0);
  if (sum !== WEIGHTS_DENOMINATOR) {
    errors.push(`Weights must sum to exactly ${WEIGHTS_DENOMINATOR.toLocaleString()} bps (got ${sum.toLocaleString()}).`);
  }
  if (args.entryFeeBps > ENTRY_FEE_CAP_BPS) {
    errors.push(`Entry fee exceeds the ${ENTRY_FEE_CAP_BPS} bps cap.`);
  }
  if (args.exitFeeBps > EXIT_FEE_CAP_BPS) {
    errors.push(`Exit fee exceeds the ${EXIT_FEE_CAP_BPS} bps cap.`);
  }
  if (args.managementFeeBps > MANAGEMENT_FEE_CAP_BPS) {
    errors.push(`Management fee exceeds the ${MANAGEMENT_FEE_CAP_BPS} bps cap.`);
  }
  for (const amount of args.seedAmounts) {
    if (BigInt(amount) <= 0n) {
      errors.push("Every seed amount must be greater than zero.");
      break;
    }
  }
  if (args.metadataHash.length !== 32 || args.metadataHash.every((b) => b === 0)) {
    errors.push("Metadata hash must be 32 non-zero bytes.");
  }
  return errors;
}

/**
 * Build the `create_basket` TransactionInstruction. Account order matches the
 * Anchor context exactly (see the module doc); any mismatch reverts on-chain.
 */
export function buildCreateBasketInstruction(
  creator: string,
  args: CreateBasketArgs,
): TransactionInstruction {
  const validationErrors = validateCreateBasketArgs(args);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid create_basket arguments: ${validationErrors.join(" ")}`);
  }

  const pda = deriveCreateBasketPdas(creator, args);
  const creatorKey = new PublicKey(creator);

  const data = concat([
    CREATE_BASKET_DISCRIMINATOR,
    u64Le(args.nonce),
    u32Le(args.constituents.length),
    ...args.constituents.map((m) => new PublicKey(m).toBytes()),
    u32Le(args.weightsBps.length),
    ...args.weightsBps.map((w) => u16Le(w)),
    u16Le(args.entryFeeBps),
    u16Le(args.exitFeeBps),
    u16Le(args.managementFeeBps),
    args.metadataHash,
    u32Le(args.seedAmounts.length),
    ...args.seedAmounts.map((a) => u64Le(a)),
  ]);

  const keys = [
    { pubkey: pda.factory, isSigner: false, isWritable: true },
    { pubkey: pda.basket, isSigner: false, isWritable: true },
    { pubkey: pda.shareMint, isSigner: false, isWritable: true },
    { pubkey: pda.vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: pda.creatorShareAta, isSigner: false, isWritable: true },
    { pubkey: creatorKey, isSigner: true, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: PublicKey.default, isSigner: false, isWritable: false },
    // CPI target for basket::init_basket (the basket data account is owned by
    // the basket program).
    { pubkey: PROGRAMS.basket, isSigner: false, isWritable: false },
  ];
  args.constituents.forEach((mint, i) => {
    keys.push({ pubkey: pda.whitelistedMints[i], isSigner: false, isWritable: false });
    keys.push({ pubkey: new PublicKey(mint), isSigner: false, isWritable: false });
    keys.push({ pubkey: pda.creatorAtas[i], isSigner: false, isWritable: true });
    keys.push({ pubkey: pda.vaultAtas[i], isSigner: false, isWritable: true });
  });

  return new TransactionInstruction({
    programId: PROGRAMS.factory,
    keys,
    data: Buffer.from(data),
  });
}

/**
 * Estimated serialized size of a v0 transaction carrying only this
 * instruction, with no address lookup tables. Solana's packet limit is 1232
 * bytes; constituent-heavy baskets exceed it without ALT compression.
 */
export function estimateCreateBasketTxSize(numConstituents: number): number {
  const accountKeys = 10 + 4 * numConstituents;
  const instructionData =
    8 +
    8 +
    (4 + 32 * numConstituents) +
    (4 + 2 * numConstituents) +
    6 +
    32 +
    (4 + 8 * numConstituents);
  // signatures (1 x 64) + message header (3) + blockhash (32) + keys + ix tags + data
  return 64 + 3 + 32 + accountKeys * 32 + 2 + 1 + 2 + instructionData;
}

/** Serialized v0 transaction size in bytes (exact, for the review modal). */
export function serializedTransactionSize(tx: {
  serialize: (config?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) => Uint8Array;
}): number {
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
}

/**
 * Read the creator's constituent ATA balances before deploy so the review can
 * show a honest shortfall instead of a failed simulation. Returns null per
 * mint when the account does not exist yet (zero balance).
 */
export async function fetchCreatorSeedBalances(
  connection: Connection,
  creator: string,
  constituents: string[],
): Promise<(bigint | null)[]> {
  const creatorKey = new PublicKey(creator);
  const balances = await Promise.all(
    constituents.map(async (mint) => {
      const ata = associatedTokenAddress(creatorKey, new PublicKey(mint));
      try {
        const info = await connection.getTokenAccountBalance(ata);
        return info.value.amount !== undefined ? BigInt(info.value.amount) : null;
      } catch {
        return null;
      }
    }),
  );
  return balances;
}

/**
 * sha256 of a UTF-8 JSON metadata blob, via WebCrypto (browser + Node 18+).
 * IPFS upload is out of scope for V0 — the JSON is hashed directly and the
 * wizard says so.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  // Copy into a plain ArrayBuffer — subtle.digest requires an ArrayBufferView
  // over ArrayBuffer (not SharedArrayBuffer) in the current DOM types.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
