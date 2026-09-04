/**
 * Client-side Anchor instruction builders for the FolioX basket program.
 *
 * NO IDL dependency — the account order, arg encoding and PDA seeds below are
 * mirrored by hand from the protocol source of truth:
 *
 *   - programs/basket/src/lib.rs   (MintInKind / RedeemInKind / AccrueFee
 *     contexts + the `mint_in_kind` remaining_accounts client contract)
 *   - programs/basket_factory/src/lib.rs (CreateBasket seeds, share-mint PDA)
 *   - programs/whitelist/src/lib.rs (MINT_SEED = b"mint")
 *
 * Account orders (verified against source on 2026-09-01):
 *
 *   mint_in_kind    named accounts in MintInKind struct order, then
 *                   remaining_accounts = [mint_i, user_ata_i, vault_ata_i]
 *                   triplets for i in basket.constituents order (3n), APPENDED
 *                   by n WhitelistedMint PDAs (whitelist program, seeds
 *                   ["mint", mint_i]) — 4n accounts total. Each whitelist PDA
 *                   must be status Active; PausedNewMints aborts with
 *                   MintPaused before any CPI or state change.
 *   redeem_in_kind  named accounts in RedeemInKind struct order, then the 3n
 *                   triplets ONLY — no whitelist, no oracle, no backend
 *                   account (permissionless by construction).
 *   accrue_management_fee  named accounts in AccrueFee struct order, no
 *                   remaining accounts. Permissionless crank (payer covers
 *                   only possible ATA rent).
 *
 * All amounts are RAW Token-2022 base units (u64) — display-only scaled values
 * are derived in the UI, never sent on-chain (AGENTS.md §7 "RAW ONLY").
 *
 * Dependency note: only @solana/web3.js (a declared dependency) is used —
 * PDA/ATA derivations and the idempotent create-ATA instruction are built by
 * hand from the canonical on-chain layouts above.
 */

import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
  type TransactionSignature,
} from "@solana/web3.js";
// web3.js types TransactionInstruction.data as Buffer; the `buffer` package is
// a real (transitive) dependency of @solana/web3.js — imported explicitly so
// the browser bundle uses the same module instance instead of a global.
import { Buffer } from "buffer";

import { CREATE_BASKET_COMPUTE_UNITS, buildCreateBasketInstruction, deriveCreateBasketPdas, estimateCreateBasketTxSize, type CreateBasketArgs } from "@/lib/create-basket";

/**
 * UTF-8 seed bytes (stand-in for Buffer.from so no Buffer global/polyfill is
 * needed in the browser bundle; findProgramAddressSync takes Uint8Array seeds).
 */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

import { PROGRAMS } from "@/lib/solana";
import { CLUSTER, explorerClusterQuery } from "@/lib/wallet";

/** programs/basket — declare_id!("37VPG…") (programs/basket/src/lib.rs:10). */
export const BASKET_PROGRAM_ID = PROGRAMS.basket;
/** programs/whitelist — declare_id!("bdED…") (programs/whitelist/src/lib.rs:5). */
export const WHITELIST_PROGRAM_ID = PROGRAMS.whitelist;
/** programs/basket_factory — declare_id!("sXSh…") (programs/basket_factory/src/lib.rs:14). */
export const FACTORY_PROGRAM_ID = PROGRAMS.factory;

/**
 * Fixed on-chain program addresses (no @solana/spl-token dependency — the
 * hoisted copy disappeared from node_modules mid-wave; these constants are
 * canonical and stable):
 *   Token-2022  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
 *   ATA program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
 */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

// ===================== discriminators =====================

/**
 * Anchor 8-byte instruction discriminators: sha256("global:<name>")[..8].
 * Hardcoded (WebCrypto sha256 is async; builders stay sync) — verified against
 * node:crypto and cross-checked against the program's own account-discriminator
 * constant `WHITELISTED_MINT_DISCRIMINATOR = sha256("account:WhitelistedMint")[..8]`.
 */
export const MINT_IN_KIND_DISCRIMINATOR = Uint8Array.from([
  101, 248, 37, 42, 151, 216, 11, 83,
]); // sha256("global:mint_in_kind")[..8] = 65f8252a97d80b53
export const REDEEM_IN_KIND_DISCRIMINATOR = Uint8Array.from([
  102, 58, 189, 252, 192, 219, 140, 89,
]); // sha256("global:redeem_in_kind")[..8] = 663abdfcc0db8c59
export const ACCRUE_MANAGEMENT_FEE_DISCRIMINATOR = Uint8Array.from([
  91, 57, 239, 81, 27, 216, 220, 148,
]); // sha256("global:accrue_management_fee")[..8] = 5b39ef511bd8dc94

// ===================== borsh arg encoding =====================

/** u32 little-endian (Borsh Vec length prefix). */
function borshU32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`borshU32: out of range ${value}`);
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

/** u64 little-endian from BigInt (Borsh integer encoding). */
export function borshU64(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 64n) {
    throw new Error(`borshU64: out of u64 range ${value}`);
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

/** Borsh Vec<u64>: u32 length prefix + little-endian u64 elements. */
function borshVecU64(values: readonly bigint[]): Uint8Array {
  if (values.length > 20) {
    // baskets carry 2-20 constituents; keep the builder honest past that.
    throw new Error(`borshVecU64: unexpected length ${values.length}`);
  }
  const parts: Uint8Array[] = [borshU32(values.length)];
  for (const v of values) parts.push(borshU64(v));
  return concatBytes(...parts);
}

// ===================== PDA / ATA derivations =====================

/**
 * Vault authority PDA — seeds [b"basket", basket.key()] derived under the
 * BASKET program id. Mirrors `vault_authority_pda` (basket_factory) and the
 * `seeds = [BASKET_SEED, basket.key()]` constraints in the basket program.
 */
export function deriveVaultAuthority(basket: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8("basket"), basket.toBuffer()],
    BASKET_PROGRAM_ID,
  );
}

/**
 * Share mint PDA — seeds [b"share_mint", basket.key()] derived under the
 * FACTORY program id (the `CreateBasket` context that initializes it runs in
 * basket_factory, so Anchor derives under that program). Cross-check against
 * the indexed `share_mint` field; the indexed value stays authoritative.
 */
export function deriveShareMint(basket: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8("share_mint"), basket.toBuffer()],
    FACTORY_PROGRAM_ID,
  );
}

/**
 * WhitelistedMint PDA — whitelist program, seeds [b"mint", mint]
 * (programs/whitelist MINT_SEED). mint_in_kind validates these are genuine
 * (owner + discriminator + stored mint) and Active.
 */
export function deriveWhitelistedMint(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8("mint"), mint.toBuffer()],
    WHITELIST_PROGRAM_ID,
  );
}

/**
 * Token-2022 associated token account (canonical ATA derivation, off-curve
 * owners allowed for PDAs such as the vault authority) — identical to
 * getAssociatedTokenAddressSync(owner, mint, true, TOKEN_2022_PROGRAM_ID):
 * PDA seeds [owner, token_program, mint] under the ATA program.
 */
export function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

/**
 * Basket PDA derivation helper, mirroring the CreateBasket context seeds
 * [b"basket", factory, creator, nonce.to_le_bytes()]. NOTE (source ambiguity,
 * flagged): the `seeds = [...]` attribute runs in the basket_factory program,
 * so Anchor derives this PDA under the FACTORY program id — while the basket
 * program reads it as a foreign `Account<'info, Basket>`. The UI never needs
 * this derivation (the basket address arrives via URL/API); it is provided for
 * reference only. If localnet E2E shows a different owner program, the
 * derivation (not the account order) needs revisiting.
 */
export function deriveBasketPda(
  factory: PublicKey,
  creator: PublicKey,
  nonce: bigint,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [utf8("basket"), factory.toBuffer(), creator.toBuffer(), borshU64(nonce)],
    FACTORY_PROGRAM_ID,
  );
}

// ===================== review-modal account lists =====================

export interface ExpectedAccount {
  /** Short role label shown in the review modal. */
  label: string;
  pubkey: PublicKey;
  /** What the transaction does to this account. */
  note: string;
  signer?: boolean;
  writable?: boolean;
}

/**
 * Basket keys every builder needs. `shareMint` comes from the indexed basket
 * row (should equal `deriveShareMint(basket)` — the indexed value stays
 * authoritative). `constituents` is the immutable basket constituent list.
 */
export interface BasketCoreKeys {
  /** The basket PDA itself (page URL / `baskets.pubkey`). */
  basket: PublicKey;
  factory: PublicKey;
  creator: PublicKey;
  treasury: PublicKey;
  shareMint: PublicKey;
  /** Immutable constituent mints, in on-chain order. */
  constituents: string[];
  /** The signing wallet (mints to / burns from this user). */
  user: PublicKey;
}

function coreAccounts(keys: BasketCoreKeys): ExpectedAccount[] {
  const [vaultAuthority] = deriveVaultAuthority(keys.basket);
  return [
    {
      label: "basket",
      pubkey: keys.basket,
      note: "Basket PDA — mutates last_fee_accrual_ts (accrual runs first)",
      writable: true,
    },
    {
      label: "share_mint",
      pubkey: keys.shareMint,
      note: "Basket share token (Token-2022, 6 decimals) — supply changes",
      writable: true,
    },
    {
      label: "user",
      pubkey: keys.user,
      note: "Your wallet — signs the transaction",
      signer: true,
      writable: true,
    },
    {
      label: "user_share_ata",
      pubkey: deriveAta(keys.user, keys.shareMint),
      note: "Your share token ATA — created idempotently if missing",
      writable: true,
    },
    {
      label: "vault_authority",
      pubkey: vaultAuthority,
      note: 'PDA ["basket", basket] — signs mints/burns/transfers for the vault',
    },
    {
      label: "creator",
      pubkey: keys.creator,
      note: "Basket creator — receives 90% of fees",
    },
    {
      label: "creator_share_ata",
      pubkey: deriveAta(keys.creator, keys.shareMint),
      note: "Creator share ATA — created idempotently if missing",
      writable: true,
    },
    {
      label: "treasury",
      pubkey: keys.treasury,
      note: "Protocol treasury — receives 10% of fees",
    },
    {
      label: "treasury_share_ata",
      pubkey: deriveAta(keys.treasury, keys.shareMint),
      note: "Treasury share ATA — created idempotently if missing",
      writable: true,
    },
    {
      label: "token_program",
      pubkey: TOKEN_2022_PROGRAM_ID,
      note: "Token-2022 program (transfer_checked / mint / burn)",
    },
    {
      label: "associated_token_program",
      pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
      note: "ATA program (idempotent account creation)",
    },
    {
      label: "system_program",
      pubkey: SystemProgram.programId,
      note: "System program (rent / account creation)",
    },
  ];
}

function constituentAccounts(
  keys: BasketCoreKeys,
  includeWhitelistGate: boolean,
): ExpectedAccount[] {
  const [vaultAuthority] = deriveVaultAuthority(keys.basket);
  const listed: ExpectedAccount[] = [];
  keys.constituents.forEach((mint, i) => {
    const mintKey = new PublicKey(mint);
    const userAta = deriveAta(keys.user, mintKey);
    const vaultAta = deriveAta(vaultAuthority, mintKey);
    listed.push(
      {
        label: `mint[${i}]`,
        pubkey: mintKey,
        note: "Constituent Token-2022 mint (read-only)",
      },
      {
        label: `user_ata[${i}]`,
        pubkey: userAta,
        note: includeWhitelistGate
          ? "Your ATA — the raw deposit leaves from here (must already exist)"
          : "Your ATA — receives the pro-rata raw amount (created if missing; you pay rent)",
        writable: true,
      },
      {
        label: `vault_ata[${i}]`,
        pubkey: vaultAta,
        note: includeWhitelistGate
          ? "Vault ATA — receives the raw deposit (balance must match on-chain state)"
          : "Vault ATA — the pro-rata raw amount leaves from here (balance must match on-chain state)",
        writable: true,
      },
    );
  });
  if (includeWhitelistGate) {
    keys.constituents.forEach((mint, i) => {
      const [pda] = deriveWhitelistedMint(new PublicKey(mint));
      listed.push({
        label: `whitelisted_mint[${i}]`,
        pubkey: pda,
        note: "Whitelist gate (read-only) — must be Active; PausedNewMints aborts the mint",
      });
    });
  }
  return listed;
}

function toMetas(accounts: ExpectedAccount[]) {
  return accounts.map((a) => ({
    pubkey: a.pubkey,
    isSigner: a.signer ?? false,
    isWritable: a.writable ?? false,
  }));
}

// ===================== mint_in_kind =====================

export interface MintInKindParams {
  keys: BasketCoreKeys;
  /** Raw deposit per constituent, in basket.constituents order (all > 0). */
  amounts: bigint[];
  /** Raw vault balance per constituent (must equal on-chain balances). */
  vaultBalances: bigint[];
}

/**
 * Build `mint_in_kind(amounts, vault_balances)`.
 *
 * remaining_accounts = [mint_i, user_ata_i, vault_ata_i] x n, THEN the n
 * WhitelistedMint PDAs (programs/basket/src/lib.rs `mint_in_kind` doc comment
 * — the CLIENT-FACING CONTRACT). Supplied vault balances must equal on-chain
 * state or the program aborts with VaultBalanceMismatch.
 */
export function buildMintInKind(
  params: MintInKindParams,
): { instructions: TransactionInstruction[]; expectedAccounts: ExpectedAccount[] } {
  const { keys, amounts, vaultBalances } = params;
  if (amounts.length !== keys.constituents.length) {
    throw new Error(
      `mint_in_kind: expected ${keys.constituents.length} amounts, got ${amounts.length}`,
    );
  }
  if (amounts.length !== vaultBalances.length) {
    throw new Error("mint_in_kind: amounts and vaultBalances length mismatch");
  }
  if (amounts.some((a) => a <= 0n)) {
    throw new Error("mint_in_kind: every amount must be > 0 (ZeroAmount)");
  }

  const accounts = [
    ...coreAccounts(keys),
    ...constituentAccounts(keys, true),
  ];

  const instruction = new TransactionInstruction({
    programId: BASKET_PROGRAM_ID,
    keys: toMetas(accounts),
    data: Buffer.from(
      concatBytes(
        MINT_IN_KIND_DISCRIMINATOR,
        borshVecU64(amounts),
        borshVecU64(vaultBalances),
      ),
    ),
  });
  return { instructions: [instruction], expectedAccounts: accounts };
}

// ===================== redeem_in_kind =====================

export interface RedeemInKindParams {
  keys: BasketCoreKeys;
  /** Raw shares to burn (u64, > 0, <= user share ATA balance). */
  sharesToBurn: bigint;
  /** Raw vault balance per constituent (must equal on-chain balances). */
  vaultBalances: bigint[];
}

/**
 * Build `redeem_in_kind(shares_to_burn, vault_balances)`.
 *
 * remaining_accounts = [mint_i, user_ata_i, vault_ata_i] x n — NO whitelist
 * PDAs, NO oracle, NO backend account. The program creates missing user
 * constituent ATAs idempotently (redeemer pays rent).
 */
export function buildRedeemInKind(
  params: RedeemInKindParams,
): { instructions: TransactionInstruction[]; expectedAccounts: ExpectedAccount[] } {
  const { keys, sharesToBurn, vaultBalances } = params;
  if (sharesToBurn <= 0n) {
    throw new Error("redeem_in_kind: sharesToBurn must be > 0 (ZeroAmount)");
  }
  if (vaultBalances.length !== keys.constituents.length) {
    throw new Error(
      `redeem_in_kind: expected ${keys.constituents.length} vault balances, got ${vaultBalances.length}`,
    );
  }

  const accounts = [
    ...coreAccounts(keys),
    ...constituentAccounts(keys, false),
  ];

  const instruction = new TransactionInstruction({
    programId: BASKET_PROGRAM_ID,
    keys: toMetas(accounts),
    data: Buffer.from(
      concatBytes(
        REDEEM_IN_KIND_DISCRIMINATOR,
        borshU64(sharesToBurn),
        borshVecU64(vaultBalances),
      ),
    ),
  });
  return { instructions: [instruction], expectedAccounts: accounts };
}

// ===================== accrue_management_fee =====================

/**
 * Build `accrue_management_fee()` — the permissionless crank. Anyone may call;
 * the payer only covers possible ATA rent. No remaining accounts. The AccrueFee
 * context has a `payer` signer instead of a `user`.
 */
export function buildAccrueManagementFee(keys: Omit<BasketCoreKeys, "user"> & { user: PublicKey }): {
  instructions: TransactionInstruction[];
  expectedAccounts: ExpectedAccount[];
} {
  const accounts = coreAccounts(keys).map((a) =>
    a.label === "user"
      ? {
          ...a,
          label: "payer",
          note: "You — the crank caller; only covers possible ATA rent",
        }
      : a,
  );
  const instruction = new TransactionInstruction({
    programId: BASKET_PROGRAM_ID,
    keys: toMetas(accounts),
    data: Buffer.from(concatBytes(ACCRUE_MANAGEMENT_FEE_DISCRIMINATOR)),
  });
  return { instructions: [instruction], expectedAccounts: accounts };
}

// ===================== ATA preflight (mint) =====================

/**
 * IDEMPOTENT create-ATA instructions (ATA program `CreateIdempotent`,
 * instruction enum 1) for the given mints. mint_in_kind requires the user's
 * constituent ATAs to EXIST (it validates + transfer_checks them), so the buy
 * page prepends these when a balance check finds a missing ATA. Same
 * transaction: instructions execute in order, so the ATAs exist by the time
 * the program validates them. Mirrors
 * spl_associated_token_account::instruction::create_idempotent.
 */
export function buildCreateAtaInstructions(
  payer: PublicKey,
  owner: PublicKey,
  mints: PublicKey[],
): TransactionInstruction[] {
  return mints.map(
    (mint) =>
      new TransactionInstruction({
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        keys: [
          { pubkey: payer, isSigner: true, isWritable: true },
          { pubkey: deriveAta(owner, mint), isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        // AssociatedTokenAccountInstruction::CreateIdempotent = 1 (no args).
        data: Buffer.from([1]),
      }),
  );
}

// ===================== v0 + address lookup tables (create_basket) =====================
//
// The 3-constituent basket ceiling is a WIRE limit, not a program limit: a
// legacy transaction may not exceed the 1232-byte Solana packet size, and the
// serialized create_basket transaction crosses it at 4 constituents
// (measured on devnet: 4→1270B, 5→1444B, 6→1618B; 3→1096B fits). From 4
// constituents on, the create wizard compiles the SAME instruction into a v0
// message whose non-signer account keys are compressed to 1-byte indexes
// through an Address Lookup Table (devnet-measured: 6 constituents → 631B).
// The programs are untouched — this is purely client-side transaction
// construction. ALT creation needs RPC signing, so the wizard calls
// `ensureCreateBasketAlt()` first (the connected wallet signs the
// create/extend transactions), then passes the table address into
// `buildCreateBasketTransaction()`.

/** Solana packet size limit. */
export const PACKET_LIMIT = 1232;

/**
 * True when a create_basket transaction with this many constituents exceeds
 * the 1232B packet limit without lookup tables (equivalently: n >= 4).
 */
export function createBasketNeedsAlt(numConstituents: number): boolean {
  return estimateCreateBasketTxSize(numConstituents) > PACKET_LIMIT;
}

/**
 * Every address a create_basket transaction references EXCEPT the creator —
 * the exact payload for the wizard's lookup table. Signers (the creator/payer)
 * must stay in the transaction's static keys, so they are excluded here.
 */
export function deriveCreateBasketAltAddresses(
  creator: string,
  args: CreateBasketArgs,
): PublicKey[] {
  const pda = deriveCreateBasketPdas(creator, args);
  const creatorKey = new PublicKey(creator);
  const candidates: PublicKey[] = [
    pda.factory,
    pda.basket,
    pda.shareMint,
    pda.vaultAuthority,
    pda.creatorShareAta,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    BASKET_PROGRAM_ID,
  ];
  args.constituents.forEach((mint, i) => {
    candidates.push(
      pda.whitelistedMints[i],
      new PublicKey(mint),
      pda.creatorAtas[i],
      pda.vaultAtas[i],
    );
  });
  const seen = new Set<string>();
  const out: PublicKey[] = [];
  for (const key of candidates) {
    if (key.equals(creatorKey)) continue;
    const base58 = key.toBase58();
    if (!seen.has(base58)) {
      seen.add(base58);
      out.push(key);
    }
  }
  return out;
}

export interface BuiltCreateBasketTx {
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
  /** Exact serialized size in bytes (zeroed signatures). */
  sizeBytes: number;
  /** False = the legacy-shaped n<=3 message, unchanged. */
  usedLookupTable: boolean;
}

/**
 * Build the create_basket transaction exactly as the wizard sends it.
 *
 * - n <= 3: v0 message with NO lookup tables and no compute-budget
 *   instructions — byte-identical behavior to the previous builder.
 * - n >= 4: requires `lookupTableAddresses` (call `ensureCreateBasketAlt()`
 *   first); compiles a v0 message through the tables with a compute-unit
 *   limit prepended (the 4+ constituent CPI chain exceeds the 200k default).
 *
 * Throws when the result would still exceed the packet limit — honest failure
 * instead of a wallet rejection downstream.
 */
export async function buildCreateBasketTransaction(params: {
  connection: Connection;
  creator: string;
  args: CreateBasketArgs;
  /** Required for n >= 4 — from ensureCreateBasketAlt(). Ignored for n <= 3. */
  lookupTableAddresses?: PublicKey[];
}): Promise<BuiltCreateBasketTx> {
  const { connection, creator, args } = params;
  const instruction = buildCreateBasketInstruction(creator, args);
  const needsAlt = createBasketNeedsAlt(args.constituents.length);
  const tables: AddressLookupTableAccount[] = [];
  if (needsAlt) {
    const provided = params.lookupTableAddresses ?? [];
    if (provided.length === 0) {
      throw new Error(
        `create_basket with ${args.constituents.length} constituents exceeds the ${PACKET_LIMIT}B packet limit — call ensureCreateBasketAlt() first and pass the lookup table address`,
      );
    }
    for (const address of provided) {
      const table = await connection.getAddressLookupTable(address);
      if (!table.value) {
        throw new Error(`address lookup table ${address.toBase58()} not found on ${connection.rpcEndpoint}`);
      }
      tables.push(table.value);
    }
  }
  // Fresh CONFIRMED blockhash (same as scripts/lib.ts sendFitting): a
  // finalized-blockhash is already ~32 slots old when fetched, which left the
  // wizard's tx ~48s of validity — long enough to expire while the user
  // reviews the wallet popup. Confirmed gives the full 150-slot window.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const instructions = needsAlt
    ? [ComputeBudgetProgram.setComputeUnitLimit({ units: CREATE_BASKET_COMPUTE_UNITS }), instruction]
    : [instruction];
  const message = new TransactionMessage({
    payerKey: new PublicKey(creator),
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(tables);
  const transaction = new VersionedTransaction(message);
  // Version-safe size measurement: message bytes + one 64-byte signature per
  // required signer (VersionedTransaction.serialize() takes no args in the
  // web3.js version the app resolves).
  const sizeBytes = transaction.message.serialize().length + transaction.signatures.length * 64;
  if (sizeBytes > PACKET_LIMIT) {
    throw new Error(
      `serialized create_basket transaction is ${sizeBytes}B > ${PACKET_LIMIT}B — lookup-table compression was insufficient`,
    );
  }
  return { transaction, blockhash, lastValidBlockHeight, sizeBytes, usedLookupTable: needsAlt };
}

/** Wallet-adapter sender shape (mirrors the create wizard's prop). */
export type WalletSendTransaction = <T extends VersionedTransaction>(
  transaction: T,
  connection: Connection,
) => Promise<TransactionSignature>;

export interface EnsureCreateBasketAltResult {
  lookupTableAddress: PublicKey;
  /** True when this call created the table (vs reusing an existing one). */
  created: boolean;
  /** How many addresses were newly extended into the table. */
  extended: number;
}

/**
 * Ensure an Address Lookup Table covering every non-signer create_basket
 * account exists on-chain, owned by (and paid for by) the connected creator
 * wallet. Idempotent, and mirrors the PROVEN devnet flow in
 * scripts/lib.ts `getOrCreateAlt` (which landed the 6-constituent basket
 * CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo):
 *
 * 1. The table address is derived deterministically from (creator, a recent
 *    finalized slot); if the account already exists it is reused.
 * 2. Otherwise the wallet signs a createLookupTable transaction, and the table
 *    account is POLLED until visible (create-confirm and RPC-visible are not
 *    the same moment on a load-balanced public cluster).
 * 3. Any addresses missing from the table are extended in packet-sized chunks
 *    (each extension is a separate wallet signature), and the on-chain table
 *    is then RE-READ and VERIFIED to contain every wanted address — with
 *    jittered retries for RPC convergence. Compiling against a table whose
 *    on-chain content lags the local copy is exactly what produced
 *    "Transaction address table lookup uses an invalid index": the message
 *    referenced indexes the executing node had not indexed yet.
 *
 * The wizard calls this BEFORE buildCreateBasketTransaction() whenever
 * `createBasketNeedsAlt()` is true; both consumer transactions (mint/redeem)
 * are unaffected — they still fit in a legacy-shaped message for the sizes the
 * app produces today.
 */
export async function ensureCreateBasketAlt(params: {
  connection: Connection;
  /** Connected wallet — becomes the table authority and pays its rent. */
  creator: string;
  args: CreateBasketArgs;
  sendTransaction: WalletSendTransaction;
  /** Optional hook so the UI can flip into an "awaiting wallet" phase. */
  onAwaitingWallet?: (awaiting: boolean) => void;
  /** Override the derivation slot (testing only — defaults to last finalized). */
  recentSlot?: number;
}): Promise<EnsureCreateBasketAltResult> {
  const { connection, creator, args, sendTransaction, onAwaitingWallet } = params;
  const authority = new PublicKey(creator);
  const addresses = deriveCreateBasketAltAddresses(creator, args);
  const recentSlot = params.recentSlot ?? (await connection.getSlot("finalized"));
  const lookupTableAddress = PublicKey.findProgramAddressSync(
    [authority.toBuffer(), borshU64(BigInt(recentSlot))],
    AddressLookupTableProgram.programId,
  )[0];

  const uniqueWanted: PublicKey[] = [];
  for (const a of addresses) {
    if (!uniqueWanted.some((w) => w.equals(a))) uniqueWanted.push(a);
  }

  let created = false;
  if (!(await connection.getAccountInfo(lookupTableAddress))) {
    const [createIx, derived] = AddressLookupTableProgram.createLookupTable({
      authority,
      payer: authority,
      recentSlot,
    });
    if (!derived.equals(lookupTableAddress)) {
      throw new Error(
        `lookup table derivation mismatch: ${derived.toBase58()} != ${lookupTableAddress.toBase58()}`,
      );
    }
    await sendWithWallet(
      connection,
      sendTransaction,
      [createIx],
      authority,
      onAwaitingWallet,
    );
    created = true;
    // The table account must be visible before it can be extended or compiled
    // against — poll (mirrors scripts/lib.ts getOrCreateAlt).
    let visible = false;
    for (let i = 0; i < 20 && !visible; i++) {
      visible = Boolean(await connection.getAccountInfo(lookupTableAddress));
      if (!visible) await sleepMs(500);
    }
    if (!visible) {
      throw new Error(
        `lookup table ${lookupTableAddress.toBase58()} was created but never became visible on ${connection.rpcEndpoint}`,
      );
    }
  }

  const readTableAddresses = async (): Promise<PublicKey[]> => {
    const table = await connection.getAddressLookupTable(lookupTableAddress);
    return table.value ? [...table.value.state.addresses] : [];
  };

  const haveBefore = await readTableAddresses();
  const missing = uniqueWanted.filter((a) => !haveBefore.some((h) => h.equals(a)));
  for (let i = 0; i < missing.length; i += 20) {
    const chunk = missing.slice(i, i + 20);
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: authority,
      authority,
      lookupTable: lookupTableAddress,
      addresses: chunk,
    });
    await sendWithWallet(
      connection,
      sendTransaction,
      [extendIx],
      authority,
      onAwaitingWallet,
    );
  }

  if (missing.length > 0 || !created) {
    // Verify the on-chain table contains every wanted address before the
    // consumer tx compiles against it. Public devnet is load-balanced: the
    // node that served the compile read and the node that executes the
    // transaction can lag each other, and an unverified compile produced the
    // "address table lookup uses an invalid index" failure. Jittered backoff
    // (no tight loop) while the cluster converges.
    let converged: PublicKey[] | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const have = await readTableAddresses();
      if (uniqueWanted.every((a) => have.some((h) => h.equals(a)))) {
        converged = have;
        break;
      }
      await sleepMs(750 + Math.floor(Math.random() * 750));
    }
    if (!converged) {
      const have = await readTableAddresses();
      const stillMissing = uniqueWanted.filter((a) => !have.some((h) => h.equals(a)));
      throw new Error(
        `lookup table ${lookupTableAddress.toBase58()} is missing ${stillMissing.length} address(es) after extension (${stillMissing
          .slice(0, 3)
          .map((a) => a.toBase58())
          .join(", ")}${stillMissing.length > 3 ? "…" : ""}) — the extension transaction may not have landed`,
      );
    }
  }
  return { lookupTableAddress, created, extended: missing.length };
}

/** Bounded wait helper (jittered by callers) — no tight RPC polling. */
function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Compile → wallet-sign → confirm a small management transaction. */
async function sendWithWallet(
  connection: Connection,
  sendTransaction: WalletSendTransaction,
  instructions: TransactionInstruction[],
  payer: PublicKey,
  onAwaitingWallet?: (awaiting: boolean) => void,
): Promise<TransactionSignature> {
  // Confirmed blockhash — a finalized one is already ~32 slots old, which
  // starves the confirmation window on a throttled public RPC.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message([]);
  const transaction = new VersionedTransaction(message);
  onAwaitingWallet?.(true);
  try {
    const signature = await sendTransaction(transaction, connection);
    const confirmation = await connection.confirmTransaction(
      { blockhash, lastValidBlockHeight, signature },
      "confirmed",
    );
    if (confirmation.value.err) {
      throw new Error(
        `lookup-table transaction confirmed with an error: ${JSON.stringify(confirmation.value.err)}`,
      );
    }
    return signature;
  } finally {
    onAwaitingWallet?.(false);
  }
}

// ===================== program error decoding =====================

/**
 * programs/basket BasketError codes. Anchor assigns Custom(6000 + index) in
 * declaration order (programs/basket/src/lib.rs `BasketError`).
 */
export const BASKET_ERROR_NAMES: Record<number, { name: string; message: string }> = {
  6000: { name: "LengthMismatch", message: "Amounts length mismatch" },
  6001: { name: "ZeroAmount", message: "Zero amount" },
  6002: { name: "MathOverflow", message: "Math overflow" },
  6003: { name: "ZeroSupply", message: "Zero supply" },
  6004: { name: "ZeroVault", message: "Zero vault balance" },
  6005: { name: "ZeroShares", message: "Zero shares computed — deposit too small for the current vault" },
  6006: { name: "WeightMismatch", message: "Deposits are off the current vault ratios by more than the 1% tolerance" },
  6007: { name: "InsufficientShares", message: "Insufficient share balance" },
  6008: { name: "ShareMintMismatch", message: "Share mint does not match the basket's share mint" },
  6009: { name: "InvalidFeeRecipient", message: "Invalid fee recipient account" },
  6010: { name: "InvalidShareAta", message: "Token account address does not match the derived ATA" },
  6011: { name: "InvalidRemainingAccounts", message: "Invalid remaining accounts layout" },
  6012: { name: "VaultBalanceMismatch", message: "Supplied vault balance does not match the on-chain balance" },
  6013: {
    name: "MintPaused",
    message:
      "A constituent's whitelist entry is PausedNewMints — new mints are blocked on-chain. Redeem is never gated by this pause.",
  },
  6014: {
    name: "InvalidWhitelistAccount",
    message: "Whitelist entry is not the genuine WhitelistedMint PDA for its constituent",
  },
};

/** True when the decoded program error is the paused-mint gate. */
export function isMintPausedError(err: unknown): boolean {
  return decodeProgramError(err)?.name === "MintPaused";
}

export interface DecodedProgramError {
  code: number;
  name: string;
  message: string;
}

/**
 * Decode an Anchor Custom program error out of a web3.js simulation result's
 * `err` ({ InstructionError: [index, { Custom: code }] }) or a thrown error
 * message ("custom program error: 0x…"). Returns null for non-program errors.
 */
export function decodeProgramError(err: unknown): DecodedProgramError | null {
  let code: number | null = null;
  if (err && typeof err === "object") {
    const candidate = err as { InstructionError?: [number, unknown] };
    const inner = candidate.InstructionError?.[1];
    if (
      inner &&
      typeof inner === "object" &&
      "Custom" in (inner as Record<string, unknown>)
    ) {
      const c = (inner as Record<string, unknown>).Custom;
      if (typeof c === "number") code = c;
    }
  }
  if (code === null) {
    const text =
      err instanceof Error ? err.message : typeof err === "string" ? err : "";
    const hex = /custom program error: 0x([0-9a-fA-F]+)/.exec(text);
    if (hex) code = parseInt(hex[1], 16);
  }
  if (code === null || !Number.isInteger(code)) return null;
  const known = BASKET_ERROR_NAMES[code];
  return {
    code,
    name: known?.name ?? `Custom(${code})`,
    message:
      known?.message ??
      "The basket program rejected this transaction with an unrecognized error code.",
  };
}

// ===================== misc helpers =====================

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Explorer URL for a transaction signature, cluster-aware (localnet maps to
 * ?cluster=custom&customUrl=<endpoint>). Path first, cluster query last.
 */
export function explorerTxUrl(signature: string, endpoint: string): string {
  return explorerUrl(`/tx/${signature}`, endpoint);
}

/** Explorer URL for an account, cluster-aware. */
export function explorerAccountUrl(address: string, endpoint: string): string {
  return explorerUrl(`/account/${address}`, endpoint);
}

function explorerUrl(path: string, endpoint: string): string {
  // Cluster comes from NEXT_PUBLIC_CLUSTER (default devnet) via lib/wallet —
  // not from endpoint-host sniffing — so links stay correct even when the RPC
  // endpoint is a local proxy in front of a public cluster.
  return `https://explorer.solana.com${path}${explorerClusterQuery(CLUSTER, endpoint)}`;
}
