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
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
// web3.js types TransactionInstruction.data as Buffer; the `buffer` package is
// a real (transitive) dependency of @solana/web3.js — imported explicitly so
// the browser bundle uses the same module instance instead of a global.
import { Buffer } from "buffer";

/**
 * UTF-8 seed bytes (stand-in for Buffer.from so no Buffer global/polyfill is
 * needed in the browser bundle; findProgramAddressSync takes Uint8Array seeds).
 */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

import { PROGRAMS } from "@/lib/solana";

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
 * ?cluster=custom&customUrl=<endpoint>).
 */
export function explorerTxUrl(signature: string, endpoint: string): string {
  return `${explorerBase(endpoint)}/tx/${signature}`;
}

/** Explorer URL for an account, cluster-aware. */
export function explorerAccountUrl(address: string, endpoint: string): string {
  return `${explorerBase(endpoint)}/account/${address}`;
}

function explorerBase(endpoint: string): string {
  let cluster: string;
  try {
    const host = new URL(endpoint).host;
    if (host === "api.devnet.solana.com") cluster = "?cluster=devnet";
    else if (host === "api.testnet.solana.com") cluster = "?cluster=testnet";
    else if (/^(localhost|127\.0\.0\.1)/.test(host))
      cluster = `?cluster=custom&customUrl=${encodeURIComponent(endpoint)}`;
    else cluster = "";
  } catch {
    cluster = "";
  }
  return `https://explorer.solana.com${cluster}`;
}
