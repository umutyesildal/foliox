/**
 * indexer/whitelistSync.ts — on-chain WhitelistedMint account indexer.
 *
 * The whitelist program (PROGRAM_WHITELIST) stores one WhitelistedMint PDA per
 * accepted mint, carrying `price_source` (e.g. "mock:tsla" on devnet,
 * "jupiter:TSLAx" on mainnet) — the label the NAV engine's mock-price fill
 * (workers/mockPriceFill.ts) and Jupiter pricing resolve against. Without this
 * sync the `whitelisted_mints` table stays empty and pricing has no labels.
 *
 * Account layout (programs/whitelist/src/lib.rs `#[account] WhitelistedMint`):
 *   disc(8) | mint(32) | decimals(1) | multiplier_watermark(8) | status(1) |
 *   price_source: String(4 + N) | bump(1)
 *
 * SAFETY: strictly read-only against RPC (AGENTS.md §2 #5). Unknown status
 * bytes are SKIPPED (never invented into a legal CHECK value); malformed
 * accounts are skipped with a warn.
 */
import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import bs58 from "bs58";
import { isPgLike, type PgLike } from "../db/client.js";

/** sha256("account:WhitelistedMint")[0..8] — Anchor account discriminator. */
export function whitelistedMintDiscriminator(): Buffer {
  return createHash("sha256").update("account:WhitelistedMint").digest().subarray(0, 8);
}

const WHITELISTED_MINT_DISC = whitelistedMintDiscriminator();

/** Fixed part after the discriminator: mint(32)+decimals(1)+watermark(8)+status(1). */
const FIXED_LEN = 32 + 1 + 8 + 1;

export interface DecodedWhitelistedMint {
  mint: string;
  decimals: number;
  /** Raw on-chain status byte (0 = Active, 1 = PausedNewMints). */
  statusRaw: number;
  /** Mapped schema value; undefined when the byte is unknown (row is skipped). */
  status?: "Active" | "PausedNewMints";
  priceSource: string;
}

/** Structural slice of @solana/web3.js Connection used here. */
export interface WhitelistRpc {
  getProgramAccounts(
    programId: PublicKey,
    config?: { filters?: Array<{ memcmp?: { offset: number; bytes: string }; dataSize?: number }>; commitment?: unknown },
  ): Promise<Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>>;
}

/** Decode one WhitelistedMint account buffer, or null when malformed. */
export function decodeWhitelistedMint(data: Buffer): DecodedWhitelistedMint | null {
  if (!data || data.length < 8 + FIXED_LEN + 4 + 1) return null; // disc+fixed+strLen+min 1-byte bump
  if (!data.subarray(0, 8).equals(WHITELISTED_MINT_DISC)) return null;
  try {
    const mint = new PublicKey(data.subarray(8, 40)).toBase58();
    const decimals = data.readUInt8(40);
    const statusRaw = data.readUInt8(49);
    const srcLen = data.readUInt32LE(50);
    if (srcLen > 64) return null; // program caps price_source at 64 chars
    const end = 54 + srcLen;
    if (end + 1 > data.length) return null; // truncated string
    const priceSource = data.subarray(54, end).toString("utf8");
    const decoded: DecodedWhitelistedMint = { mint, decimals, statusRaw, priceSource };
    if (statusRaw === 0) decoded.status = "Active";
    else if (statusRaw === 1) decoded.status = "PausedNewMints";
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Read every WhitelistedMint account from the whitelist program and upsert it
 * into `whitelisted_mints` (price_source included). Returns the number of rows
 * upserted. Unknown status bytes and malformed accounts are skipped + warned.
 */
export async function syncWhitelistedMints(
  rpc: WhitelistRpc,
  programId: string,
  db: PgLike | null | undefined,
): Promise<number> {
  if (!isPgLike(db)) {
    console.warn("[whitelistSync] skipped (no DB)");
    return 0;
  }
  const accounts = await rpc.getProgramAccounts(new PublicKey(programId), {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(WHITELISTED_MINT_DISC) } }],
  });
  let synced = 0;
  for (const { pubkey, account } of accounts) {
    const decoded = decodeWhitelistedMint(account.data);
    if (!decoded) {
      console.warn(`[whitelistSync] undecodable WhitelistedMint account ${pubkey.toBase58()} — skipped`);
      continue;
    }
    if (!decoded.status) {
      console.warn(`[whitelistSync] ${decoded.mint}: unknown status byte ${decoded.statusRaw} — skipped`);
      continue;
    }
    await db.query(
      `INSERT INTO whitelisted_mints (mint, decimals, status, price_source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mint) DO UPDATE
         SET decimals = EXCLUDED.decimals,
             status = EXCLUDED.status,
             price_source = EXCLUDED.price_source,
             updated_at = NOW()`,
      [decoded.mint, decoded.decimals, decoded.status, decoded.priceSource],
    );
    synced++;
  }
  return synced;
}
