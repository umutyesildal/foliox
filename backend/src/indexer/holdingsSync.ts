/**
 * indexer/holdingsSync.ts — real vault holdings sync (spec §4.3, §7).
 *
 * Reads vault ATAs in batches via `getMultipleAccountsInfo`, reads each
 * constituent's Token-2022 mint ScaledUiAmountConfig multiplier via
 * unpackMint/getScaledUiAmountConfig (fallback 1.0 when absent/legacy/error),
 * and produces rows carrying raw + multiplier + scaled + decimals.
 *
 * INTEGER-SAFETY CONVENTION (AGENTS.md §2 #7 — crosses module boundaries):
 *   * `raw` is the on-chain u64 amount carried as a bigint; `rawAmount` is the
 *     same value as a DECIMAL STRING for binding into BIGINT columns
 *     (vault_holdings.raw_amount, supply columns). Never pass `Number(raw)`.
 *   * `multiplier` is the f64 ScaledUiAmountConfig multiplier (token-2022
 *     stores it as f64; @solana/spl-token 0.4.15 parses it as f64 — the spec's
 *     "u64 fixed-point with multiplier_decimals" sketch predates that layout).
 *   * `scaled` = raw × multiplier ÷ 10^decimals in HUMAN units (display/NAV
 *     only). `scaledAmount` is the exact decimal string stored in the NUMERIC
 *     column; `scaled` is its Number rounding for the NAV engine. Programs
 *     consume raw only — scaled never flows back on-chain.
 *
 * Degradation: every RPC touch goes through a structural `SolanaRpc` param and
 * every DB write through a `PgLike | null` param; null db simply skips
 * persistence and still returns rows.
 */
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getScaledUiAmountConfig,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import { isPgLike } from "../db/client.js";

/** Minimal structural slice of @solana/web3.js Connection used here. */
export interface SolanaRpc {
  getMultipleAccountsInfo(
    keys: PublicKey[],
    commitment?: unknown,
  ): Promise<Array<AccountInfo<Buffer> | null>>;
  getAccountInfo(address: PublicKey): Promise<AccountInfo<Buffer> | null>;
}

export interface HoldingsRow {
  basket: string;
  mint: string;
  /** On-chain u64 amount — bigint, the source of truth for all math. */
  raw: bigint;
  /** Same u64 as a decimal string for BIGINT-safe SQL binding. */
  rawAmount: string;
  /** Token-2022 ScaledUiAmountConfig multiplier; 1.0 fallback. */
  multiplier: number;
  /** Display/NAV units: raw × multiplier ÷ 10^decimals (Number rounding). */
  scaled: number;
  /** Exact decimal string of `scaled` for the NUMERIC column. */
  scaledAmount: string;
  decimals: number;
}

const MULTISIG_SIZE = 355; // spl-token: extended mints must not collide with multisig size

export interface MintFacts {
  multiplier: number;
  decimals: number;
}

/**
 * Read `decimals` straight from a mint account buffer (base Mint layout puts
 * the u8 at offset 44 — valid for both legacy and Token-2022 mints). Returns
 * null when the buffer is too short or the value is implausible.
 */
export function parseMintDecimalsFromMintData(data: Buffer): number | null {
  if (data.length < 45) return null;
  const decimals = data.readUInt8(44);
  if (decimals > 60) return null;
  return decimals;
}

/**
 * Multiplier + decimals for one mint. Both degrade honestly: multiplier 1.0
 * (spec §4.3 fallback) and the 6-decimal share-mint standard when the mint
 * account cannot be read (warned, never thrown).
 */
export async function fetchMintFacts(rpc: SolanaRpc, mint: PublicKey): Promise<MintFacts> {
  try {
    const info = await rpc.getAccountInfo(mint);
    if (!info) {
      console.warn(`[holdings] mint ${mint.toBase58()} not found — multiplier 1.0, decimals 6 (fallback)`);
      return { multiplier: 1.0, decimals: 6 };
    }
    const multiplier = info.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? parseScaledUiMultiplierFromMintData(info.data) ?? 1.0
      : 1.0; // legacy SPL token mints have no ScaledUiAmountConfig
    const decimals = parseMintDecimalsFromMintData(info.data) ?? 6;
    return { multiplier, decimals };
  } catch (err) {
    console.warn(`[holdings] mint ${mint.toBase58()} read failed — fallback:`, err instanceof Error ? err.message : err);
    return { multiplier: 1.0, decimals: 6 };
  }
}

/**
 * Parse the ScaledUiAmountConfig multiplier out of raw Token-2022 mint account
 * data. Pure function — fixture-testable. Returns null when the account is
 * legacy (no extensions) or the extension is missing.
 */
export function parseScaledUiMultiplierFromMintData(data: Buffer): number | null {
  try {
    if (data.length <= 82) return null; // base mint only, no TLV stream
    // Extended token-2022 mints are larger than a token account (165) and not
    // multisig-sized (355); AccountType byte sits at offset 165, TLV at 166.
    if (data.length <= 165 || data.length === MULTISIG_SIZE) return null;
    if (data[165] !== 1) return null; // AccountType.Mint
    const mint = unpackMint(PublicKey.default, {
      executable: false,
      owner: TOKEN_2022_PROGRAM_ID,
      lamports: 0,
      data,
    }, TOKEN_2022_PROGRAM_ID);
    const cfg = getScaledUiAmountConfig(mint);
    if (!cfg) return null;
    const multiplier = Number(cfg.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
    return multiplier;
  } catch {
    return null;
  }
}

/**
 * Read the ScaledUiAmountConfig multiplier for `mint` from RPC.
 * Fallback is 1.0 (spec §4.3): legacy Token mints, missing extension, RPC
 * error, or malformed data all degrade to 1.0.
 */
export async function fetchMultiplier(rpc: SolanaRpc, mint: PublicKey): Promise<number> {
  try {
    const info = await rpc.getAccountInfo(mint);
    if (!info) return 1.0;
    if (!info.owner.equals(TOKEN_2022_PROGRAM_ID)) return 1.0; // legacy SPL token
    return parseScaledUiMultiplierFromMintData(info.data) ?? 1.0;
  } catch {
    return 1.0;
  }
}

/**
 * Exact scaled value as a decimal string: raw × multiplier ÷ 10^decimals,
 * computed with BigInt fixed-point (9 digits for the f64 multiplier) so no
 * u64-scale precision is ever lost to Number.
 */
export function exactScaledDecimalString(raw: bigint, multiplier: number, decimals: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || raw === 0n) return "0";
  const MULT_SCALE = 9; // f64 multiplier captured to 9 decimal places
  const multFixed = BigInt(Math.round(multiplier * 10 ** MULT_SCALE));
  const num = raw * multFixed;
  const den = 10n ** BigInt(MULT_SCALE + decimals);
  const whole = num / den;
  const rem = num % den;
  if (rem === 0n) return whole.toString();
  const frac = rem.toString().padStart(MULT_SCALE + decimals, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Multipliers for many mints (sequential — one getAccountInfo each). */
export async function fetchMultipliers(rpc: SolanaRpc, mints: PublicKey[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const mint of mints) map.set(mint.toBase58(), await fetchMultiplier(rpc, mint));
  return map;
}

/**
 * Sync vault holdings: batch-read the ATAs, read multipliers, compute
 * raw/multiplier/scaled/decimals rows. Optionally persist into
 * vault_holdings (and ensure the whitelisted_mints FK rows exist) when
 * `opts.db` is a pg client.
 */
export async function syncHoldings(
  rpc: SolanaRpc,
  basket: PublicKey,
  vaultAtas: PublicKey[],
  mints: PublicKey[],
  opts: { db?: unknown } = {},
): Promise<HoldingsRow[]> {
  const db = isPgLike(opts?.db) ? opts.db : null;
  const facts = new Map<string, MintFacts>();
  for (const mint of mints) facts.set(mint.toBase58(), await fetchMintFacts(rpc, mint));

  const infos: Array<AccountInfo<Buffer> | null> = [];
  for (const batch of chunk(vaultAtas, 100)) {
    infos.push(...(await rpc.getMultipleAccountsInfo(batch)));
  }

  const rows: HoldingsRow[] = [];
  for (let i = 0; i < vaultAtas.length; i++) {
    const mint = mints[i];
    const mintKey = mint.toBase58();
    const info = infos[i] ?? null;
    let raw = 0n;
    const mintFacts = facts.get(mintKey) ?? { multiplier: 1.0, decimals: 6 };
    let decimals = mintFacts.decimals;
    if (info) {
      try {
        const programId = info.owner.equals(TOKEN_PROGRAM_ID) ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
        const account = unpackAccount(vaultAtas[i], info, programId);
        raw = account.amount; // bigint — u64 safe
        if (account.mint.toBase58() !== mintKey) {
          console.warn(`[holdings] ATA ${vaultAtas[i].toBase58()} holds mint ${account.mint.toBase58()}, expected ${mintKey}`);
        }
      } catch (err) {
        console.warn(`[holdings] failed to unpack ATA ${vaultAtas[i].toBase58()}:`, err instanceof Error ? err.message : err);
      }
    }
    const multiplier = mintFacts.multiplier;
    const scaledAmount = exactScaledDecimalString(raw, multiplier, decimals);
    rows.push({
      basket: basket.toBase58(),
      mint: mintKey,
      raw,
      rawAmount: raw.toString(),
      multiplier,
      scaled: Number(scaledAmount), // display rounding — NAV engine input
      scaledAmount,
      decimals,
    });
  }

  if (db) await upsertVaultHoldings(db, rows);
  return rows;
}

/**
 * Persist holdings rows. raw_amount is bound from the decimal string; the
 * whitelisted_mints FK row is ensured first. Status is only set on INSERT
 * (defaults to 'Active'); existing rows keep their status untouched.
 */
export async function upsertVaultHoldings(db: unknown, rows: HoldingsRow[]): Promise<boolean> {
  if (!isPgLike(db)) {
    console.warn("[holdings] upsertVaultHoldings skipped (no DB)");
    return false;
  }
  for (const row of rows) {
    await db.query(
      `INSERT INTO whitelisted_mints (mint, decimals, status, multiplier)
       VALUES ($1, $2, 'Active', $3)
       ON CONFLICT (mint) DO UPDATE
         SET decimals = EXCLUDED.decimals,
             multiplier = EXCLUDED.multiplier,
             updated_at = NOW()`,
      [row.mint, row.decimals, row.multiplier],
    );
    await db.query(
      `INSERT INTO vault_holdings (basket, mint, raw_amount, multiplier, scaled_amount, decimals, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (basket, mint) DO UPDATE
         SET raw_amount = EXCLUDED.raw_amount,
             multiplier = EXCLUDED.multiplier,
             scaled_amount = EXCLUDED.scaled_amount,
             decimals = EXCLUDED.decimals,
             updated_at = NOW()`,
      [
        row.basket,
        row.mint,
        row.rawAmount, // decimal string → BIGINT (integer-safe)
        row.multiplier,
        row.scaledAmount, // exact decimal string → NUMERIC
        row.decimals,
      ],
    );
  }
  return true;
}

// --- PDA / ATA derivation helpers -------------------------------------------

/** u64 little-endian bytes (for PDA seeds) from a decimal string or bigint. */
export function u64LeBytes(value: string | bigint): Buffer {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n || v >= 2n ** 64n) throw new Error(`u64 out of range: ${value}`);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(v);
  return buf;
}

/**
 * Basket PDA: seeds = ["basket", factory, creator, nonce_le]
 * (programs/basket_factory/src/lib.rs CreateBasket seeds).
 */
export function deriveBasketPda(factory: PublicKey, creator: PublicKey, nonce: string | bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("basket"), factory.toBuffer(), creator.toBuffer(), u64LeBytes(nonce)],
    new PublicKey("37VPGtd57kXJ1HvH1xvdZr1y3s4KXj9pP2o6GdYLgbb1"), // basket program (Anchor.toml)
  )[0];
}

/** Vault ATAs: basket PDA owns one ATA per constituent mint (Token-2022). */
export function getVaultAtas(basketPda: PublicKey, mints: PublicKey[]): PublicKey[] {
  return mints.map((mint) =>
    getAssociatedTokenAddressSync(mint, basketPda, true, TOKEN_2022_PROGRAM_ID),
  );
}
