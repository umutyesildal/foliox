/**
 * Holdings Sync Worker — reads vault ATAs raw + multiplier → scaled
 * Backend is convenience only; redeem remains permissionless even if this fails.
 */
import { Connection, PublicKey } from "@solana/web3.js";

export interface HoldingsRow {
  basket: string;
  mint: string;
  raw: bigint;
  multiplier: number; // 1.0 default
  scaled: number;
  decimals: number;
}

export async function fetchMultiplier(connection: Connection, mint: PublicKey): Promise<number> {
  // Token-2022 ScaledUiAmountConfig extension: read account data and parse multiplier
  // V0: try getAccountInfo and unpack, fallback to 1.0 if no extension
  try {
    const info = await connection.getAccountInfo(mint);
    if (!info) return 1;
    // Use @solana/spl-token unpackMint with TOKEN_2022_PROGRAM_ID
    // If extension present, extract multiplier; here we mock.
    // Real impl: getScaledUiAmountConfig(mintInfo).multiplier / 10**decimals
    return 1; // placeholder — integrate spl-token getMint
  } catch {
    return 1;
  }
}

export async function syncHoldings(connection: Connection, basket: PublicKey, vaultAtas: PublicKey[], mints: PublicKey[]) {
  const rows: HoldingsRow[] = [];
  for (let i = 0; i < vaultAtas.length; i++) {
    const ataInfo = await connection.getTokenAccountBalance(vaultAtas[i]).catch(() => null);
    const raw = ataInfo ? BigInt(ataInfo.value.amount) : 0n;
    const decimals = ataInfo?.value.decimals ?? 6;
    const multiplier = await fetchMultiplier(connection, mints[i]);
    const scaled = Number(raw) * multiplier / 10 ** decimals; // display
    rows.push({
      basket: basket.toBase58(),
      mint: mints[i].toBase58(),
      raw,
      multiplier,
      scaled,
      decimals,
    });
  }
  return rows;
}
