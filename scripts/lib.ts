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
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
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

/** Loads or creates a keypair file inside the state dir. */
export function stateKeypair(name: string): Keypair {
  const file = path.join(stateDir(), name);
  if (fs.existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/** Loads a keypair from a JSON secret-key file. */
export function keypairFromFile(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

/** The e2e payer (authority / creator). Uses $FOLIOX_E2E_PAYER or a generated state keypair. */
export function payerKeypair(): Keypair {
  const p = process.env.FOLIOX_E2E_PAYER;
  if (p && fs.existsSync(p)) return keypairFromFile(p);
  return stateKeypair("payer.json");
}

export function rpcUrl(): string {
  return process.env.FOLIOX_E2E_RPC_URL || "http://127.0.0.1:8899";
}

export function newConnection(): Connection {
  return new Connection(rpcUrl(), { commitment: "confirmed" });
}

export async function ensureSol(
  conn: Connection,
  kp: Keypair,
  minSol: number,
  airdropSol: number,
): Promise<void> {
  let bal = await conn.getBalance(kp.publicKey, "confirmed");
  if (bal >= minSol * Number(LAMPORTS_PER_SOL)) return;
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

/** Send + confirm, printing the signature. */
export async function send(
  conn: Connection,
  name: string,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): Promise<string> {
  const tx = new Transaction().add(...withCuLimit(ixs));
  const sig = await sendAndConfirmTransaction(conn, tx, signers, {
    skipPreflight: false,
  });
  console.log(`  tx ${name}: ${sig}`);
  return sig;
}

/**
 * Send + confirm, returning false instead of throwing when the tx fails.
 * Safe for probes: a failed Solana transaction is atomic, so a failed
 * create-mint attempt (e.g. wrong extension space) leaves no state behind.
 */
export async function trySend(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): Promise<boolean> {
  try {
    const tx = new Transaction().add(...withCuLimit(ixs));
    await sendAndConfirmTransaction(conn, tx, signers, { skipPreflight: true });
    return true;
  } catch {
    return false;
  }
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
