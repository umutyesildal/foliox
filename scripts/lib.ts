/**
 * Shared helpers for the FolioX localnet E2E scripts (scripts/*.ts).
 *
 * No @solana/spl-token dependency (not installed in this workspace) — the
 * Token-2022 instruction layouts below mirror the on-chain program directly:
 *   - spl_token_2022_interface 1.0.0 instruction.rs / extension TLV layout
 *   - instruction tags: InitializeMint2=20, TransferChecked=12, MintTo=7,
 *     SetAuthority=6, ScaledUiAmountExtension=43 (inner Initialize=0)
 *   - TLV entry = [type: u16 LE][length: u16 LE][value]
 *   - ScaledUiAmountConfig TLV value (56 bytes) = authority [u8;32] (zeroes =
 *     none) + multiplier f64 LE + new_multiplier_effective_timestamp i64 LE +
 *     new_multiplier f64 LE  → ExtensionType::ScaledUiAmount = 25
 *   - mint account with the extension = 82 base + 1 account type + 4 TLV header
 *     + 56 value = 143 bytes (the program also accepts 226 = "82 + 83 padding +
 *     1 type + 60 TLV" per the interface doc comment; the script probes both
 *     sizes via simulateTransaction and falls back to a plain mint when the
 *     deployed Token-2022 predates the extension).
 *
 * Program IDs are the declared ones (declare_id! / Anchor.toml) and are NOT
 * configurable: the basket and basket_factory programs compile the whitelist
 * id and the basket id into cross-program checks (WHITELIST_PROGRAM_ID,
 * vault_authority_pda), so every program must sit exactly at these addresses.
 */

import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

// ===================== fixed addresses =====================

/** programs/whitelist — declare_id! (programs/whitelist/src/lib.rs:5). */
export const WHITELIST_PROGRAM_ID = new PublicKey(
  "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS",
);
/** programs/basket_factory — declare_id! (programs/basket_factory/src/lib.rs:15). */
export const FACTORY_PROGRAM_ID = new PublicKey(
  "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF",
);
/** programs/basket — declare_id! (programs/basket/src/lib.rs:5). */
export const BASKET_PROGRAM_ID = new PublicKey(
  "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k",
);
/** Canonical Token-2022 program. */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
/** Canonical SPL associated token account program. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const SYSTEM_PROGRAM_ID = SystemProgram.programId;

// ===================== Anchor sighash =====================

/** Anchor 8-byte instruction discriminator: sha256("global:<name>")[..8]. */
export function sighash(name: string): Buffer {
  return Buffer.from(
    createHash("sha256").update(`global:${name}`).digest().subarray(0, 8),
  );
}

// ===================== borsh encoding =====================

export function borshU8(v: number): Buffer {
  const b = Buffer.alloc(1);
  b.writeUInt8(v, 0);
  return b;
}
export function borshU16(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
}
export function borshU32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}
export function borshU64(v: bigint): Buffer {
  if (v < 0n || v >= 1n << 64n) throw new Error(`borshU64 out of range: ${v}`);
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}
export function borshF64(v: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(v, 0);
  return b;
}
/** Borsh Vec<T> length prefix. */
export function vecLen(n: number): Buffer {
  return borshU32(n);
}
/** COption<Pubkey> as serialized inside Token-2022 instruction data (4+32). */
export function cOptionPubkey(v: PublicKey | null): Buffer {
  if (!v) return Buffer.concat([borshU32(0), Buffer.alloc(32)]);
  return Buffer.concat([borshU32(1), v.toBuffer()]);
}
export function concat(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}

// ===================== PDA derivations (mirror the Rust sources) =====================

/** WhitelistConfig PDA — seeds [b"config"] under the whitelist program. */
export function deriveWhitelistConfig(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    WHITELIST_PROGRAM_ID,
  )[0];
}
/** WhitelistedMint PDA — seeds [b"mint", mint] under the whitelist program. */
export function deriveWhitelistedMint(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint"), mint.toBuffer()],
    WHITELIST_PROGRAM_ID,
  )[0];
}
/** FactoryConfig PDA — seeds [b"factory"] under the factory program. */
export function deriveFactoryConfig(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("factory")],
    FACTORY_PROGRAM_ID,
  )[0];
}
/**
 * Basket PDA — seeds [b"basket", factory, creator, nonce.to_le_bytes()]
 * derived under the FACTORY program id (the CreateBasket context runs in
 * basket_factory; the basket program only deserializes Account<Basket> with no
 * seeds constraint — verified against source 2026-09-01).
 */
export function deriveBasketPda(
  factory: PublicKey,
  creator: PublicKey,
  nonce: bigint,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("basket"),
      factory.toBuffer(),
      creator.toBuffer(),
      borshU64(nonce),
    ],
    FACTORY_PROGRAM_ID,
  )[0];
}
/** Share mint PDA — seeds [b"share_mint", basket] under the FACTORY program. */
export function deriveShareMint(basket: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), basket.toBuffer()],
    FACTORY_PROGRAM_ID,
  )[0];
}
/** Vault/share-mint authority PDA — [b"basket", basket] under the BASKET program. */
export function deriveVaultAuthority(basket: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("basket"), basket.toBuffer()],
    BASKET_PROGRAM_ID,
  )[0];
}
/** Token-2022 associated token account (supports off-curve owners). */
export function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

// ===================== Token-2022 raw instructions =====================

/** InitializeMint2 (tag 20) — accounts: [mint(w)]. */
export function initializeMint2(
  mint: PublicKey,
  decimals: number,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data: concat(
      borshU8(20),
      borshU8(decimals),
      mintAuthority.toBuffer(),
      cOptionPubkey(freezeAuthority),
    ),
  });
}

/**
 * InitializeScaledUiAmountConfig — outer tag 43 (TokenInstruction::
 * ScaledUiAmountExtension), inner variant 0 (Initialize), payload = authority
 * [u8;32] (zeroes = none) + multiplier f64. Accounts: [mint(w)].
 */
export function initializeScaledUiAmountConfig(
  mint: PublicKey,
  multiplier: number,
  authority: PublicKey | null,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data: concat(
      borshU8(43),
      borshU8(0),
      authority ? authority.toBuffer() : Buffer.alloc(32),
      borshF64(multiplier),
    ),
  });
}

/** MintTo (tag 7) — accounts: [mint(w), destination(w), authority(s)]. */
export function mintTo(
  mint: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: bigint,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: concat(borshU8(7), borshU64(amount)),
  });
}

/** TransferChecked (tag 12) — accounts: [source(w), mint(r), dest(w), authority(s)]. */
export function transferChecked(
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: bigint,
  decimals: number,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: concat(borshU8(12), borshU64(amount), borshU8(decimals)),
  });
}

/** ATA program CreateIdempotent (variant 1) — mirrors create_idempotent. */
export function createAtaIdempotent(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: deriveAta(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

// ===================== program instruction builders =====================

export interface Meta {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}
function m(pubkey: PublicKey, isWritable: boolean, isSigner = false): Meta {
  return { pubkey, isSigner, isWritable };
}

/** whitelist init_config — config, authority(signer), system. */
export function ixInitConfig(authority: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: WHITELIST_PROGRAM_ID,
    keys: [
      m(deriveWhitelistConfig(), true),
      m(authority, true, true),
      m(SYSTEM_PROGRAM_ID, false),
    ],
    data: sighash("init_config"),
  });
}

/** whitelist add_mint(decimals, price_source) — config, authority, mint, whitelisted_mint, system. */
export function ixAddMint(
  authority: PublicKey,
  mint: PublicKey,
  decimals: number,
  priceSource: string,
): TransactionInstruction {
  const src = Buffer.from(priceSource, "utf8");
  return new TransactionInstruction({
    programId: WHITELIST_PROGRAM_ID,
    keys: [
      m(deriveWhitelistConfig(), true),
      m(authority, true, true),
      m(mint, false),
      m(deriveWhitelistedMint(mint), true),
      m(SYSTEM_PROGRAM_ID, false),
    ],
    data: concat(
      sighash("add_mint"),
      borshU8(decimals),
      vecLen(src.length),
      src,
    ),
  });
}

/** whitelist pause_mint / unpause_mint — config, authority(signer), whitelisted_mint(mut). */
export function ixSetMintPaused(
  authority: PublicKey,
  mint: PublicKey,
  pause: boolean,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: WHITELIST_PROGRAM_ID,
    keys: [
      m(deriveWhitelistConfig(), false),
      m(authority, false, true),
      m(deriveWhitelistedMint(mint), true),
    ],
    data: sighash(pause ? "pause_mint" : "unpause_mint"),
  });
}

/** factory init_factory(treasury, creator_fee_split_bps) — factory, authority(signer), system. */
export function ixInitFactory(
  authority: PublicKey,
  treasury: PublicKey,
  creatorFeeSplitBps: number,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: FACTORY_PROGRAM_ID,
    keys: [
      m(deriveFactoryConfig(), true),
      m(authority, true, true),
      m(SYSTEM_PROGRAM_ID, false),
    ],
    data: concat(
      sighash("init_factory"),
      treasury.toBuffer(),
      borshU16(creatorFeeSplitBps),
    ),
  });
}

export interface CreateBasketArgs {
  creator: PublicKey;
  nonce: bigint;
  constituents: PublicKey[];
  weightsBps: number[];
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  metadataHash: Buffer;
  seedAmounts: bigint[];
  shareMint: PublicKey;
  basket: PublicKey;
}
/**
 * factory create_basket — named accounts in CreateBasket order (factory,
 * basket, share_mint, vault_authority, creator_share_ata, creator,
 * token_program, associated_token_program, system, basket_program) then
 * remaining_accounts per constituent:
 * [whitelisted_mint_pda, mint, creator_ata, vault_ata].
 */
export function ixCreateBasket(a: CreateBasketArgs): TransactionInstruction {
  const keys: Meta[] = [
    m(deriveFactoryConfig(), true),
    m(a.basket, true),
    m(a.shareMint, true),
    m(deriveVaultAuthority(a.basket), false),
    m(deriveAta(a.creator, a.shareMint), true),
    m(a.creator, true, true),
    m(TOKEN_2022_PROGRAM_ID, false),
    m(ASSOCIATED_TOKEN_PROGRAM_ID, false),
    m(SYSTEM_PROGRAM_ID, false),
    // CPI target for basket::init_basket (the basket data account is owned by
    // the basket program).
    m(BASKET_PROGRAM_ID, false),
  ];
  a.constituents.forEach((mint) => {
    keys.push(
      m(deriveWhitelistedMint(mint), false),
      m(mint, false),
      m(deriveAta(a.creator, mint), true),
      m(deriveAta(deriveVaultAuthority(a.basket), mint), true),
    );
  });
  const data = concat(
    sighash("create_basket"),
    borshU64(a.nonce),
    vecLen(a.constituents.length),
    Buffer.concat(a.constituents.map((k) => k.toBuffer())),
    vecLen(a.weightsBps.length),
    Buffer.concat(a.weightsBps.map((w) => borshU16(w))),
    borshU16(a.entryFeeBps),
    borshU16(a.exitFeeBps),
    borshU16(a.managementFeeBps),
    a.metadataHash,
    vecLen(a.seedAmounts.length),
    Buffer.concat(a.seedAmounts.map((s) => borshU64(s))),
  );
  return new TransactionInstruction({
    programId: FACTORY_PROGRAM_ID,
    keys,
    data,
  });
}

export interface BasketCore {
  basket: PublicKey;
  shareMint: PublicKey;
  user: PublicKey;
  creator: PublicKey;
  treasury: PublicKey;
  constituents: PublicKey[];
}
function coreKeys(c: BasketCore): Meta[] {
  return [
    m(c.basket, true),
    m(c.shareMint, true),
    m(c.user, true, true),
    m(deriveAta(c.user, c.shareMint), true),
    m(deriveVaultAuthority(c.basket), false),
    m(c.creator, false),
    m(deriveAta(c.creator, c.shareMint), true),
    m(c.treasury, false),
    m(deriveAta(c.treasury, c.shareMint), true),
    m(TOKEN_2022_PROGRAM_ID, false),
    m(ASSOCIATED_TOKEN_PROGRAM_ID, false),
    m(SYSTEM_PROGRAM_ID, false),
  ];
}
/**
 * basket mint_in_kind(amounts, vault_balances) — named accounts in
 * MintInKind order, then remaining_accounts = [mint, user_ata, vault_ata]×n
 * triplets FIRST, then the n WhitelistedMint PDAs appended (4n total).
 */
export function ixMintInKind(
  c: BasketCore,
  amounts: bigint[],
  vaultBalances: bigint[],
): TransactionInstruction {
  const keys = coreKeys(c);
  c.constituents.forEach((mint) => {
    keys.push(
      m(mint, false),
      m(deriveAta(c.user, mint), true),
      m(deriveAta(deriveVaultAuthority(c.basket), mint), true),
    );
  });
  c.constituents.forEach((mint) => {
    keys.push(m(deriveWhitelistedMint(mint), false));
  });
  return new TransactionInstruction({
    programId: BASKET_PROGRAM_ID,
    keys,
    data: concat(
      sighash("mint_in_kind"),
      vecLen(amounts.length),
      Buffer.concat(amounts.map((a) => borshU64(a))),
      vecLen(vaultBalances.length),
      Buffer.concat(vaultBalances.map((v) => borshU64(v))),
    ),
  });
}
/**
 * basket redeem_in_kind(shares, vault_balances) — same named accounts, then
 * the 3n triplets ONLY (no whitelist PDA, no oracle, no backend account).
 */
export function ixRedeemInKind(
  c: BasketCore,
  shares: bigint,
  vaultBalances: bigint[],
): TransactionInstruction {
  const keys = coreKeys(c);
  c.constituents.forEach((mint) => {
    keys.push(
      m(mint, false),
      m(deriveAta(c.user, mint), true),
      m(deriveAta(deriveVaultAuthority(c.basket), mint), true),
    );
  });
  return new TransactionInstruction({
    programId: BASKET_PROGRAM_ID,
    keys,
    data: concat(
      sighash("redeem_in_kind"),
      borshU64(shares),
      vecLen(vaultBalances.length),
      Buffer.concat(vaultBalances.map((v) => borshU64(v))),
    ),
  });
}
/**
 * basket accrue_management_fee() — AccrueFee order: basket, share_mint,
 * payer(signer), vault_authority, creator, creator_share_ata, treasury,
 * treasury_share_ata, token_program, associated_token_program, system.
 */
export function ixAccrueManagementFee(
  c: Omit<BasketCore, "user">,
  payer: PublicKey,
): TransactionInstruction {
  const keys: Meta[] = [
    m(c.basket, true),
    m(c.shareMint, true),
    m(payer, true, true),
    m(deriveVaultAuthority(c.basket), false),
    m(c.creator, false),
    m(deriveAta(c.creator, c.shareMint), true),
    m(c.treasury, false),
    m(deriveAta(c.treasury, c.shareMint), true),
    m(TOKEN_2022_PROGRAM_ID, false),
    m(ASSOCIATED_TOKEN_PROGRAM_ID, false),
    m(SYSTEM_PROGRAM_ID, false),
  ];
  return new TransactionInstruction({
    programId: BASKET_PROGRAM_ID,
    keys,
    data: sighash("accrue_management_fee"),
  });
}

// ===================== on-chain state readers =====================

export async function readMint(
  conn: Connection,
  mint: PublicKey,
): Promise<{ supply: bigint; decimals: number; scaledExtension: boolean } | null> {
  const info = await conn.getAccountInfo(mint);
  if (!info) return null;
  const d = info.data;
  const supply = d.readBigUInt64LE(36);
  const decimals = d[44];
  // TLV starts after the 82-byte base mint + 1 account-type byte.
  let scaledExtension = false;
  if (d.length > 83) {
    const extType = d.readUInt16LE(83);
    scaledExtension = extType === 25; // ExtensionType::ScaledUiAmount
  }
  return { supply, decimals, scaledExtension };
}

export async function readTokenAmount(
  conn: Connection,
  ata: PublicKey,
): Promise<bigint | null> {
  const info = await conn.getAccountInfo(ata);
  if (!info) return null;
  return info.data.readBigUInt64LE(64);
}

/** Clock sysvar unix_timestamp (i64 at offset 32 of the 40-byte clock account). */
export async function readClockTimestamp(conn: Connection): Promise<number> {
  const CLOCK = new PublicKey("SysvarC1ock11111111111111111111111111111111");
  const info = await conn.getAccountInfo(CLOCK);
  if (!info) throw new Error("clock sysvar missing");
  return Number(info.data.readBigInt64LE(32));
}

/**
 * Basket.last_fee_accrual_ts — i64 at offset 8 (disc) + 4*32 (factory/creator/
 * treasury/share_mint) + 8 (nonce) + 8 (created_at) = 152.
 */
export async function readBasketLastAccrual(
  conn: Connection,
  basket: PublicKey,
): Promise<number> {
  const info = await conn.getAccountInfo(basket);
  if (!info) throw new Error("basket account missing");
  return Number(info.data.readBigInt64LE(152));
}

// ===================== wallets / state / io =====================

const LAMPORTS_PER_SOL = 1_000_000_000n;

export function stateDir(): string {
  const dir =
    process.env.FOLIOX_E2E_STATE_DIR ||
    path.join(process.cwd(), "scripts", ".e2e");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveState(patch: Record<string, unknown>): void {
  const file = path.join(stateDir(), "state.json");
  let cur: Record<string, unknown> = {};
  if (fs.existsSync(file)) cur = JSON.parse(fs.readFileSync(file, "utf8"));
  cur = { ...cur, ...patch };
  fs.writeFileSync(file, JSON.stringify(cur, null, 2));
}

export function loadState(): Record<string, any> {
  const file = path.join(stateDir(), "state.json");
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Keyfile names are state-dir-relative ONLY: `[A-Za-z0-9._-]+`, no path
 * separators, no `..` segments. Resolves against stateDir() and refuses to
 * return any path that escapes it — every state keypair read/write goes
 * through this containment check.
 */
const KEYPAIR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function keypairFilename(name: string): string {
  if (typeof name !== "string" || name.includes("..") || !KEYPAIR_NAME_RE.test(name)) {
    throw new Error(
      `invalid keypair name ${JSON.stringify(String(name).slice(0, 64))}: expected [A-Za-z0-9._-]+ without path separators`,
    );
  }
  const dir = path.resolve(stateDir());
  const file = path.resolve(dir, name);
  if (!file.startsWith(dir + path.sep)) {
    throw new Error(`keypair name ${JSON.stringify(name)} resolves outside the state dir`);
  }
  return file;
}

/**
 * Operator-provided keypair path (env overrides: FOLIOX_E2E_PAYER,
 * FOLIOX_E2E_TREASURY). Only plain path characters are allowed — no `..`
 * segments, whitespace, shell metacharacters or option-like strings.
 */
const KEYPAIR_PATH_RE = /^\/?[A-Za-z0-9][A-Za-z0-9._\-/]{0,4095}$/;

/**
 * Loads a keypair from a JSON secret-key file. Hard containment: whatever the
 * caller passes, the OS-resolved real path of the file must live INSIDE the
 * state dir — bare names resolve against stateDir(), absolute paths are
 * accepted only when already under it (set FOLIOX_E2E_STATE_DIR to that
 * directory). `..` segments and non-path characters are rejected before
 * anything touches the filesystem.
 */
export function keypairFromFile(file: string): Keypair {
  if (typeof file !== "string" || file.includes("..") || !KEYPAIR_PATH_RE.test(file)) {
    throw new Error(
      `invalid keypair path ${JSON.stringify(String(file).slice(0, 64))}: expected a plain filesystem path without '..'`,
    );
  }
  const dir = path.resolve(stateDir());
  const resolved = path.isAbsolute(file) ? path.resolve(file) : path.resolve(dir, file);
  // realpathSync resolves symlinks and gives the OS-canonical location, so the
  // containment check below cannot be bypassed by a link planted in the dir.
  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    throw new Error(`keypair file not found: ${resolved}`);
  }
  if (!real.startsWith(dir + path.sep)) {
    throw new Error(
      `keypair file ${JSON.stringify(file)} resolves outside the state dir (${dir}) — pass a state-dir-relative name or set FOLIOX_E2E_STATE_DIR`,
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(real, "utf8"))));
}

/**
 * E2E keypair overrides come from env vars (FOLIOX_E2E_PAYER,
 * FOLIOX_E2E_TREASURY). The env var NAME is passed as a literal; the value is
 * read, normalized, charset-checked and contained to the state dir here — the
 * same self-contained pattern as stateDir() — so no environment-derived path
 * ever crosses a call boundary.
 *
 * Returns null when the variable is unset; throws loudly when it is set but
 * not a safe path, missing, or outside the state dir.
 */
export function envKeypair(name: "FOLIOX_E2E_PAYER" | "FOLIOX_E2E_TREASURY"): Keypair | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const file = path.normalize(raw);
  if (file.includes("..") || !KEYPAIR_PATH_RE.test(file)) {
    throw new Error(`${name} is not a safe keypair path: ${JSON.stringify(raw.slice(0, 64))}`);
  }
  const dir = path.resolve(stateDir());
  const resolved = path.isAbsolute(file) ? path.resolve(file) : path.resolve(dir, file);
  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    throw new Error(`${name} keypair file not found: ${resolved}`);
  }
  if (!real.startsWith(dir + path.sep)) {
    throw new Error(
      `${name} resolves outside the state dir (${dir}) — pass a state-dir-relative name or set FOLIOX_E2E_STATE_DIR`,
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(real, "utf8"))));
}

/** Loads or creates a keypair file inside the state dir. */
export function stateKeypair(name: string): Keypair {
  const file = keypairFilename(name);
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/** The e2e payer (authority / creator). Uses $FOLIOX_E2E_PAYER or a generated state keypair. */
export function payerKeypair(): Keypair {
  return envKeypair("FOLIOX_E2E_PAYER") ?? stateKeypair("payer.json");
}

export function rpcUrl(): string {
  return process.env.FOLIOX_E2E_RPC_URL || "http://127.0.0.1:8899";
}

/**
 * Custom fetch with jittered backoff for the public cluster's 429 rate limit.
 * web3.js's built-in retry gives up after ~7.5s (500ms→4s ×5); on
 * api.devnet.solana.com that is nowhere near enough when the backend indexer,
 * NAV jobs and the UI share the same endpoint. This fetch keeps retrying with
 * spaced, jittered waits (no tight loop) and only returns when the call
 * succeeds or attempts are exhausted — web3.js then applies its own loop on
 * top of whatever comes back. NOTE: fetchMiddleware cannot do this in this
 * web3.js version (its third arg resolves fetch ARGS; it cannot retry), and a
 * naive middleware that calls the third arg as a function silently doubles
 * every request. Localnet never throttles, so it is skipped there.
 */
async function retryFetch(
  url: RequestInfo | URL,
  options: RequestInit | undefined,
): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    last = await fetch(url, options);
    if (last.status !== 429 && last.status < 500) return last;
    if (attempt < 7) {
      const waitMs = Math.min(20_000, 4000 * (attempt + 1)) + Math.floor(Math.random() * 4000);
      process.stdout.write(
        `  rpc throttled (HTTP ${last.status}) — backing off ${(waitMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/8)\n`,
      );
      await sleep(waitMs);
    }
  }
  return last!;
}

export function newConnection(): Connection {
  const endpoint = rpcUrl();
  return new Connection(endpoint, {
    commitment: "confirmed",
    ...(isLocalnet(endpoint) ? {} : { fetch: retryFetch as unknown as typeof fetch }),
  });
}

/** Below this balance a non-localnet RPC refuses to continue (no airdrop there). */
const DEVNET_MIN_SOL = 0.3;

function isLocalnet(endpoint: string): boolean {
  return endpoint.includes("127.0.0.1") || endpoint.includes("localhost");
}

export async function ensureSol(
  conn: Connection,
  kp: Keypair,
  minSol: number,
  airdropSol: number,
): Promise<void> {
  let bal = await conn.getBalance(kp.publicKey, "confirmed");
  if (bal >= minSol * Number(LAMPORTS_PER_SOL)) return;
  if (!isLocalnet(conn.rpcEndpoint)) {
    // NEVER airdrop on a public cluster (devnet/mainnet): the request either
    // fails or drains a shared faucet. Continue as long as the wallet can pay
    // the fees for this step; otherwise stop loudly.
    if (bal < DEVNET_MIN_SOL * Number(LAMPORTS_PER_SOL)) {
      throw new Error(
        `no airdrop on ${conn.rpcEndpoint}: balance ${bal / 1e9} SOL < ${DEVNET_MIN_SOL} SOL minimum — fund ${kp.publicKey.toBase58()} manually`,
      );
    }
    console.log(
      `  NOTE: balance ${bal / 1e9} SOL < ${minSol} SOL requested on ${conn.rpcEndpoint} — continuing (no airdrop on a public cluster)`,
    );
    return;
  }
  const amt = airdropSol * Number(LAMPORTS_PER_SOL);
  process.stdout.write(
    `  airdropping ${airdropSol} SOL to ${kp.publicKey.toBase58()} (balance ${bal / 1e9} SOL)\n`,
  );
  for (let i = 0; i < 5; i++) {
    try {
      const sig = await conn.requestAirdrop(kp.publicKey, amt);
      const latest = await conn.getLatestBlockhash();
      await conn.confirmTransaction({ signature: sig, ...latest }, "confirmed");
      break;
    } catch (e) {
      if (i === 4) throw e;
      await sleep(1500);
    }
  }
  bal = await conn.getBalance(kp.publicKey, "confirmed");
  if (bal < minSol * Number(LAMPORTS_PER_SOL)) {
    throw new Error(`airdrop failed: balance ${bal} < ${minSol} SOL`);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Compute-unit limit prepended to every e2e transaction: single-instruction
 * protocol flows (create_basket, mint/redeem with ATA creation + multi-CPI
 * loops) sit at or above the 200k default per-transaction budget, and CU usage
 * varies slightly per run — request headroom (no fee: only PRICE costs lamports).
 */
export const E2E_COMPUTE_UNITS = 500_000;

function withCuLimit(ixs: TransactionInstruction[]): TransactionInstruction[] {
  return [ComputeBudgetProgram.setComputeUnitLimit({ units: E2E_COMPUTE_UNITS }), ...ixs];
}

/** Errors that mean "the cluster throttled us / blockhash went stale" — retry, not a program failure. */
const TRANSIENT_RE =
  /(429|Too Many Requests|rate.?limit|ws error|ECONNRESET|ETIMEDOUT|socket hang up|blockhash|block hash|BlockhashNotFound|not found in cache|was not submitted)/i;

function isTransient(err: unknown): boolean {
  const anyErr = err as { transactionMessage?: string; getLogs?: unknown };
  const texts = [anyErr?.transactionMessage, err instanceof Error ? err.message : String(err)];
  return texts.some((t) => typeof t === "string" && TRANSIENT_RE.test(t));
}

/** Inter-transaction throttle: public clusters rate-limit; localhost does not. */
async function txPace(): Promise<void> {
  if (!isLocalnet(rpcUrl())) await sleep(2500);
}

/** sendAndConfirmTransaction with backoff on transient (429 / blockhash) errors. */
async function sendRetry(
  conn: Connection,
  tx: Transaction,
  signers: Keypair[],
  opts: { skipPreflight: boolean },
  tries = 5,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      // Re-fetch a fresh blockhash per attempt; Transaction keeps no pool.
      (tx as unknown as { recentBlockhash?: string }).recentBlockhash = undefined;
      tx.feePayer = signers[0].publicKey;
      return await sendAndConfirmTransaction(conn, tx, signers, opts);
    } catch (e) {
      lastErr = e;
      if (i === tries - 1 || !isTransient(e)) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

/** Send + confirm, printing the signature. */
export async function send(
  conn: Connection,
  name: string,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): Promise<string> {
  await txPace();
  const tx = new Transaction().add(...withCuLimit(ixs));
  const sig = await sendRetry(conn, tx, signers, { skipPreflight: false });
  console.log(`  tx ${name}: ${sig}`);
  return sig;
}

/**
 * Send + confirm, returning false instead of throwing when the tx fails.
 * Safe for probes: a failed Solana transaction is atomic, so a failed
 * create-mint attempt (e.g. wrong extension space) leaves no state behind.
 * Transient transport errors (devnet 429 / stale blockhash) are retried with
 * backoff and do NOT count as layout rejections.
 */
export async function trySend(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): Promise<boolean> {
  await txPace();
  const tx = new Transaction().add(...withCuLimit(ixs));
  try {
    await sendRetry(conn, tx, signers, { skipPreflight: true });
    return true;
  } catch (e) {
    if (isTransient(e)) return false; // give up after retries — caller may re-probe
    return false;
  }
}

// ===================== versioned (v0) transactions + address lookup tables =====================
//
// The 3-constituent basket ceiling is a WIRE limit, not a program limit: a
// legacy (v1) transaction may not exceed the 1232-byte Solana packet size, and
// create_basket with n=6 serializes to ~1618B. v0 messages with Address Lookup
// Tables (ALTs) compress every non-signer account key to a 1-byte table index,
// so the same instruction fits. The programs are untouched — this is purely
// client-side transaction construction.

/** Solana packet size limit — the reason v0+ALT exists. */
export const PACKET_LIMIT = 1232;

export interface V0Options {
  computeUnitLimit?: number;
  computeUnitPrice?: number;
}

/** A plausible 32-byte blockhash placeholder used purely for SIZE measurement. */
const MEASURE_BLOCKHASH = "11111111111111111111111111111111";

/** Prepends the compute-budget instructions (limit + optional priority price). */
function withV0Budget(
  instructions: TransactionInstruction[],
  opts: V0Options,
): TransactionInstruction[] {
  const budget: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnitLimit ?? E2E_COMPUTE_UNITS }),
  ];
  if (opts.computeUnitPrice !== undefined && opts.computeUnitPrice > 0) {
    budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.computeUnitPrice }));
  }
  return [...budget, ...instructions];
}

/**
 * Fetch the on-chain ALT accounts for `compileToV0Message` (it needs the full
 * AddressLookupTableAccount, not just the address).
 */
export async function loadLookupTables(
  conn: Connection,
  addresses: PublicKey[],
): Promise<AddressLookupTableAccount[]> {
  const out: AddressLookupTableAccount[] = [];
  for (const a of addresses) {
    const table = await conn.getAddressLookupTable(a);
    if (!table.value) throw new Error(`address lookup table ${a.toBase58()} not found on-chain`);
    out.push(table.value);
  }
  return out;
}

/**
 * Compile instructions into a v0 message (referencing the given ALT accounts)
 * and wrap it in a VersionedTransaction. The blockhash is only meaningful when
 * the tx will be signed+sent; for size measurement any 32-byte value works.
 */
export function toVersionedTx(
  instructions: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[],
  payer: PublicKey,
  blockhash: string,
  opts: V0Options = {},
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: withV0Budget(instructions, opts),
  }).compileToV0Message(lookupTables);
  return new VersionedTransaction(message);
}

/** Serialized wire size of a legacy or versioned transaction (zeroed signatures). */
export function serializedTxSize(
  tx: Transaction | VersionedTransaction,
): number {
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
}

/**
 * What these instructions would cost on the legacy wire (with the standard CU
 * budget prepended) — the gate that decides whether v0+ALT is needed at all.
 * Uses serializeMessage() + signature bytes: Transaction.serialize() hard-throws
 * above 1232 and we need the actual number to report.
 */
export function legacyWireSize(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  opts: V0Options = {},
): number {
  const tx = new Transaction().add(...withV0Budget(instructions, opts));
  tx.feePayer = payer;
  tx.recentBlockhash = MEASURE_BLOCKHASH;
  return 64 + tx.serializeMessage().length; // 1 ed25519 signature (64B) + message
}

/** u64 LE buffer — the ALT PDA derives from (authority, recent_slot u64 LE). */
function u64LeBytes(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}

/** ALT PDA for (authority, recentSlot) — mirrors AddressLookupTableProgram. */
export function deriveAltAddress(authority: PublicKey, recentSlot: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [authority.toBuffer(), u64LeBytes(BigInt(recentSlot))],
    AddressLookupTableProgram.programId,
  )[0];
}

async function readAltAddresses(
  conn: Connection,
  address: PublicKey,
): Promise<PublicKey[]> {
  const table = await conn.getAddressLookupTable(address);
  return table.value ? [...table.value.state.addresses] : [];
}

/**
 * Create + extend an ALT idempotently, keyed by `name` in state.json:
 *   alts: { [name]: { address, authority, slot, addresses } }
 *
 * - Cached + on-chain: extends with any MISSING addresses only (the ALT program
 *   rejects duplicates), then returns.
 * - Cached but account gone: falls through to create.
 * - Not cached: picks recentSlot = last finalized slot, derives the table
 *   address (PDA of [authority, slot] under the ALT program), sends
 *   createLookupTable (found "by signature" of that transaction), verifies the
 *   account landed, then extends in chunks that fit the packet limit.
 *
 * Only the authority signs the management transactions — the consumer tx
 * (create_basket / mint_in_kind …) never needs the authority.
 */
export async function getOrCreateAlt(
  conn: Connection,
  authority: Keypair,
  name: string,
  addresses: (PublicKey | null | undefined)[],
): Promise<{ address: PublicKey; created: boolean; extended: number }> {
  const wanted: PublicKey[] = [];
  for (const a of addresses) {
    if (a && !wanted.some((w) => w.equals(a))) wanted.push(a);
  }
  if (wanted.length > 256) {
    throw new Error(`ALT ${name}: ${wanted.length} addresses > 256 table capacity`);
  }

  const state = loadState();
  const alts: Record<string, {
    address: string;
    authority: string;
    slot: number;
    addresses?: string[];
  }> = state.alts ?? {};
  const cached = alts[name];
  if (cached) {
    const address = new PublicKey(cached.address);
    if (await conn.getAccountInfo(address)) {
      const have = await readAltAddresses(conn, address);
      const missing = wanted.filter((w) => !have.some((h) => h.equals(w)));
      if (missing.length > 0) {
        await extendAlt(conn, authority, address, missing);
        const now = await readAltAddresses(conn, address);
        saveState({
          alts: { ...alts, [name]: { ...cached, addresses: now.map((p) => p.toBase58()) } },
        });
      }
      console.log(
        `  ALT ${name}: ${address.toBase58()} (${wanted.length} wanted, ${missing.length} newly extended)`,
      );
      return { address, created: false, extended: missing.length };
    }
    console.log(`  ALT ${name}: cached ${cached.address} missing on-chain — recreating`);
  }

  const recentSlot = await conn.getSlot("finalized");
  const address = deriveAltAddress(authority.publicKey, recentSlot);
  if (!(await conn.getAccountInfo(address))) {
    const [createIx, derivedAddress] = AddressLookupTableProgram.createLookupTable({
      authority: authority.publicKey,
      payer: authority.publicKey,
      recentSlot,
    });
    if (!derivedAddress.equals(address)) {
      throw new Error(
        `ALT ${name}: derivation mismatch ${derivedAddress.toBase58()} != ${address.toBase58()}`,
      );
    }
    await send(conn, `alt_create_${name}`, [createIx], [authority]);
    // The table account must be visible before we can extend it.
    for (let i = 0; i < 20; i++) {
      if (await conn.getAccountInfo(address)) break;
      await sleep(500);
    }
    if (!(await conn.getAccountInfo(address))) {
      throw new Error(`ALT ${name}: create tx confirmed but ${address.toBase58()} not found`);
    }
  }
  await extendAlt(conn, authority, address, wanted);
  const now = await readAltAddresses(conn, address);
  saveState({
    alts: {
      ...alts,
      [name]: {
        address: address.toBase58(),
        authority: authority.publicKey.toBase58(),
        slot: recentSlot,
        addresses: now.map((p) => p.toBase58()),
      },
    },
  });
  console.log(`  ALT ${name}: ${address.toBase58()} created @slot ${recentSlot} (${now.length} addresses)`);
  return { address, created: true, extended: wanted.length };
}

/** extendLookupTable in packet-sized chunks (32B/address → ≤ 20 per ix). */
async function extendAlt(
  conn: Connection,
  authority: Keypair,
  address: PublicKey,
  missing: PublicKey[],
): Promise<void> {
  for (let i = 0; i < missing.length; i += 20) {
    const chunk = missing.slice(i, i + 20);
    await send(
      conn,
      `alt_extend_${address.toBase58().slice(0, 6)}_${i}`,
      [
        AddressLookupTableProgram.extendLookupTable({
          payer: authority.publicKey,
          authority: authority.publicKey,
          lookupTable: address,
          addresses: chunk,
        }),
      ],
      [authority],
    );
  }
}

export interface SendFitted {
  signature: string;
  wire: "legacy" | "v0";
  altAddress: string | null;
  legacySize: number;
  v0Size: number | null;
}

/**
 * Send with the smallest wire format that fits: legacy while the serialized
 * transaction stays under the 1232-byte packet limit (existing proofs stay
 * byte-reproducible), v0+ALT only when size demands it.
 *
 * `altAddresses` is the FULL candidate list — signer keys are filtered here
 * (a v0 signer must sit in static keys, never in a lookup table).
 */
export async function sendFitting(
  conn: Connection,
  name: string,
  instructions: TransactionInstruction[],
  signers: Keypair[],
  opts: {
    altName?: string;
    altAddresses?: (PublicKey | null | undefined)[];
    altAuthority?: Keypair;
    computeUnitLimit?: number;
    computeUnitPrice?: number;
  } = {},
): Promise<SendFitted> {
  const payer = signers[0].publicKey;
  const v0opts: V0Options = {
    computeUnitLimit: opts.computeUnitLimit,
    computeUnitPrice: opts.computeUnitPrice,
  };
  const legacySize = legacyWireSize(instructions, payer, v0opts);
  if (legacySize <= PACKET_LIMIT) {
    const signature = await send(conn, name, instructions, signers);
    return { signature, wire: "legacy", altAddress: null, legacySize, v0Size: null };
  }
  if (!opts.altName || !opts.altAddresses || opts.altAddresses.length === 0) {
    throw new Error(
      `${name}: legacy wire size ${legacySize}B > ${PACKET_LIMIT}B and no ALT configured`,
    );
  }
  const signerKeys = signers.map((s) => s.publicKey);
  const altAuthority = opts.altAuthority ?? signers[0];
  const alt = await getOrCreateAlt(conn, altAuthority, opts.altName, opts.altAddresses);
  const tables = await loadLookupTables(conn, [alt.address]);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = toVersionedTx(instructions, tables, payer, blockhash, v0opts);
  const v0Size = serializedTxSize(tx);
  if (v0Size > PACKET_LIMIT) {
    throw new Error(
      `${name}: even with ALT ${alt.address.toBase58()} the v0 message is ${v0Size}B > ${PACKET_LIMIT}B`,
    );
  }
  console.log(`  ${name}: legacy ${legacySize}B > ${PACKET_LIMIT}B — v0+ALT ${v0Size}B`);
  const signature = await sendVersioned(
    conn,
    name,
    tx,
    signers,
    { blockhash, lastValidBlockHeight },
    (freshBlockhash) => toVersionedTx(instructions, tables, payer, freshBlockhash, v0opts),
  );
  return { signature, wire: "v0", altAddress: alt.address.toBase58(), legacySize, v0Size };
}

/**
 * Sign + send an already-compiled VersionedTransaction with backoff on
 * transient (429 / blockhash) errors. Rebuilds the tx per attempt with a fresh
 * blockhash via `rebuild` when provided.
 */
export async function sendVersioned(
  conn: Connection,
  name: string,
  tx: VersionedTransaction,
  signers: Keypair[],
  ctx: { blockhash: string; lastValidBlockHeight: number },
  rebuild?: (blockhash: string) => VersionedTransaction,
  tries = 5,
): Promise<string> {
  await txPace();
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      if (i > 0 && rebuild) {
        const { blockhash } = await conn.getLatestBlockhash();
        tx = rebuild(blockhash);
      }
      tx.sign(signers);
      const signature = await conn.sendTransaction(tx, { skipPreflight: false });
      const latest = await conn.getLatestBlockhash();
      await conn.confirmTransaction(
        { signature, ...latest },
        "confirmed",
      );
      console.log(`  tx ${name}: ${signature}`);
      return signature;
    } catch (e) {
      lastErr = e;
      if (i === tries - 1 || !isTransient(e)) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

/** Convenience: compile a v0 tx, measure it, sign+send with retries. */
export async function sendV0(
  conn: Connection,
  name: string,
  instructions: TransactionInstruction[],
  signers: Keypair[],
  lookupTables: PublicKey[],
  opts: V0Options = {},
): Promise<string> {
  const payer = signers[0].publicKey;
  const tables = await loadLookupTables(conn, lookupTables);
  const build = (blockhash: string) =>
    toVersionedTx(instructions, tables, payer, blockhash, opts);
  await txPace();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = build(blockhash);
  const size = serializedTxSize(tx);
  if (size > PACKET_LIMIT) {
    throw new Error(`${name}: v0 wire size ${size}B > ${PACKET_LIMIT}B (tables: ${lookupTables.length})`);
  }
  return sendVersioned(conn, name, tx, signers, { blockhash, lastValidBlockHeight }, build);
}

// ===================== program error names (debug aid) =====================

const ERR_NAMES: Record<number, string> = {};
[
  ["wl", ["PriceSourceTooLong", "InvalidDecimals", "AlreadyPaused", "NotPaused", "Unauthorized", "NoPendingAuthority", "InvalidMintOwner", "DecimalsMismatch"]],
  ["fx", ["LengthMismatch", "InvalidConstituentCount", "WeightsNot10000", "DuplicateMint", "EmptyMetadataHash", "ZeroSeedAmount", "FeeOverCap", "InvalidSplit", "BasketCountOverflow", "InvalidRemainingAccounts", "InvalidWhitelistAccount", "NotWhitelisted", "MintNotActive", "DecimalsMismatch", "MintMismatch", "InvalidMintAccount", "InvalidCreatorAta", "InsufficientSeedBalance", "InvalidVaultAta", "InvalidVaultAuthority", "InvalidShareAta", "InvalidTokenProgram"]],
  ["bskt", ["LengthMismatch", "ZeroAmount", "MathOverflow", "ZeroSupply", "ZeroVault", "ZeroShares", "WeightMismatch", "InsufficientShares", "ShareMintMismatch", "InvalidFeeRecipient", "InvalidShareAta", "InvalidRemainingAccounts", "VaultBalanceMismatch", "MintPaused", "InvalidWhitelistAccount"]],
].forEach(([prefix, names]) => {
  (names as string[]).forEach((n, i) => {
    ERR_NAMES[6000 + i] = `${prefix}:${n}`;
  });
});

/** Extracts a Custom(N) program error code from a send/sim failure. */
export function decodeCustomCode(err: unknown): number | null {
  const text = err instanceof Error ? err.message : String(err);
  const hex = /custom program error: 0x([0-9a-fA-F]+)/.exec(text);
  if (hex) return parseInt(hex[1], 16);
  const dec = /"Custom":\s*(\d+)/.exec(text);
  if (dec) return parseInt(dec[1], 10);
  return null;
}

export function describeErr(err: unknown): string {
  const code = decodeCustomCode(err);
  const msg = err instanceof Error ? err.message : String(err);
  const short = msg.split("\n").slice(-2).join(" ").slice(0, 300);
  return code !== null ? `${short} (${code} = ${ERR_NAMES[code] ?? "unknown"})` : short;
}

// ===================== per-basket state registry =====================

/** Shape of one entry in state.json `baskets` (written by createBasket.ts). */
export interface BasketEntry {
  factory?: string;
  basket: string;
  shareMint: string;
  vaultAuthority?: string;
  creator: string;
  creatorShareAta?: string;
  treasury: string;
  treasuryShareAta?: string;
  nonce?: string;
  numConstituents?: number;
  constituents?: string[];
  constituentSymbols?: string[];
  weightsBps?: number[];
  feesBps?: { entry: number; exit: number; mgmt: number };
  seedAmounts?: string[];
  metadataBlob?: string;
  createTx?: string;
}

/**
 * Basket selector for downstream scripts (mintAndRedeem / accrueFee /
 * verifyClientBuilders): FOLIOX_E2E_BASKET=<nonce> picks an explicit
 * state.baskets entry; unset = the NEWEST basket (highest nonce). Falls back
 * to the flat pre-registry top-level state when `baskets` doesn't exist yet.
 */
export function selectBasket(state: Record<string, any> = loadState()): {
  key: string;
  entry: BasketEntry;
} {
  const baskets: Record<string, BasketEntry> = state.baskets ?? {};
  const wanted = process.env.FOLIOX_E2E_BASKET;
  if (wanted !== undefined && wanted !== "") {
    const entry = baskets[wanted];
    if (!entry) {
      throw new Error(
        `FOLIOX_E2E_BASKET=${wanted}: no such state.baskets entry (have ${Object.keys(baskets).join(", ") || "none"})`,
      );
    }
    return { key: wanted, entry };
  }
  const keys = Object.keys(baskets).sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1));
  if (keys.length > 0) return { key: keys[0], entry: baskets[keys[0]] };
  if (!state.basket) {
    throw new Error("no basket in state — run scripts/createBasket.ts first");
  }
  return { key: String(state.nonce ?? "0"), entry: state as unknown as BasketEntry };
}

// ===================== step runner =====================

let stepFailed = false;
export function hasStepFailure(): boolean {
  return stepFailed;
}

export async function step(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`\n[STEP] ${name}\n`);
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    stepFailed = true;
    console.log(`FAIL: ${name}`);
    console.log(`  ${describeErr(e)}`);
  }
}

/** Format raw (6-decimal) token amounts for humans. */
export function fmtRaw(raw: bigint, decimals = 6): string {
  const scaled = Number(raw) / 10 ** decimals;
  return `${raw} raw (${scaled.toFixed(decimals)} ui)`;
}
