"use client";

/**
 * Exact BigInt replicas of programs/basket math (u128-intermediate / floor
 * semantics) for client-side preview validation. These mirror — never replace —
 * the on-chain checks; the program re-validates everything at execution time.
 */

/** Parse a raw base-unit input (integer string) to BigInt; null when invalid. */
export function parseRawInput(input: string): bigint | null {
  const trimmed = input.trim().replace(/_/g, "");
  if (!/^\d+$/.test(trimmed)) return null;
  try {
    const value = BigInt(trimmed);
    if (value >= 1n << 64n) return null; // u64 range
    return value;
  } catch {
    return null;
  }
}

export type GrossCheckError =
  | { kind: "ZeroAmount"; index: number }
  | { kind: "ZeroVault"; index: number }
  | { kind: "ZeroSupply" }
  | { kind: "ZeroShares" }
  | { kind: "WeightMismatch"; minIndex: number; minVal: bigint; maxDiff: bigint };

export interface GrossCheckOk {
  ok: true;
  /** min(D_i * S / V_i) — the program's gross. */
  gross: bigint;
  perLeg: bigint[];
  /** Index of the limiting (smallest) leg — it determines the gross. */
  limitingIndex: number;
}

export interface GrossCheckErr {
  ok: false;
  error: GrossCheckError;
}

/**
 * math::gross_shares with the 1% tolerance resolved per leg:
 * g_i = D_i * S / V_i (floor), gross = min(g_i), reject when
 * (max - min) * 100 > min (strictly the program's `diff * 100 <= min` pass
 * condition).
 */
export function checkGrossShares(
  deposits: bigint[],
  vaultBalances: bigint[],
  totalSupply: bigint,
): GrossCheckOk | GrossCheckErr {
  if (deposits.length !== vaultBalances.length) {
    return { ok: false, error: { kind: "ZeroShares" } };
  }
  if (totalSupply <= 0n) return { ok: false, error: { kind: "ZeroSupply" } };
  const perLeg: bigint[] = [];
  for (let i = 0; i < deposits.length; i++) {
    const d = deposits[i];
    const v = vaultBalances[i];
    if (d <= 0n) return { ok: false, error: { kind: "ZeroAmount", index: i } };
    if (v <= 0n) return { ok: false, error: { kind: "ZeroVault", index: i } };
    perLeg.push((d * totalSupply) / v);
  }
  let minVal = perLeg[0];
  let maxVal = perLeg[0];
  let limitingIndex = 0;
  perLeg.forEach((g, i) => {
    if (g < minVal) {
      minVal = g;
      limitingIndex = i;
    }
    if (g > maxVal) maxVal = g;
  });
  const gross = minVal;
  if (gross <= 0n) return { ok: false, error: { kind: "ZeroShares" } };
  if (maxVal > minVal) {
    const diff = maxVal - minVal;
    if (diff * 100n > minVal) {
      return {
        ok: false,
        error: { kind: "WeightMismatch", minIndex: limitingIndex, minVal, maxDiff: diff },
      };
    }
  }
  return { ok: true, gross, perLeg, limitingIndex };
}

/** math::entry_fee — floor(gross * bps / 10000). */
export function entryFeeOf(gross: bigint, bps: number): bigint {
  return (gross * BigInt(bps)) / 10000n;
}

export interface RedeemPreview {
  exitFee: bigint;
  burn: bigint;
  outs: bigint[];
}

/**
 * math::exit_fee + math::redeem_amounts:
 * exitFee = floor(B * bps / 10000); burn = B - exitFee;
 * out_i = floor(V_i * burn / S).
 */
export function computeRedeemPreview(
  vaultBalances: bigint[],
  totalSupply: bigint,
  shares: bigint,
  exitFeeBps: number,
): RedeemPreview | null {
  if (shares <= 0n || totalSupply <= 0n) return null;
  const exitFee = (shares * BigInt(exitFeeBps)) / 10000n;
  const burn = shares - exitFee;
  if (burn <= 0n) return { exitFee, burn: 0n, outs: vaultBalances.map(() => 0n) };
  return {
    exitFee,
    burn,
    outs: vaultBalances.map((v) => (v * burn) / totalSupply),
  };
}

/**
 * Human display for the share mint (6 decimals, fixed). BigInt-exact string
 * slice — no float drift for u64-scale supplies.
 */
export function formatRawShares6(raw: bigint): string {
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(7, "0");
  const int = digits.slice(0, digits.length - 6);
  const frac = digits.slice(digits.length - 6).replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return frac ? `${sign}${int}.${frac}` : `${sign}${int}`;
}

/**
 * Given one authoritative leg amount D_i and vault balances, the proportional
 * deposits for every other leg: D_j = floor(D_i * V_j / V_i). Mirrors the
 * WeightMismatch contract (deposits proportional to CURRENT vault ratios).
 */
export function proportionalDeposits(
  amounts: bigint[],
  vaultBalances: bigint[],
  anchorIndex: number,
): bigint[] {
  const anchorAmount = amounts[anchorIndex];
  const anchorVault = vaultBalances[anchorIndex];
  if (anchorAmount <= 0n || anchorVault <= 0n) return amounts.map(() => 0n);
  return vaultBalances.map((v, j) => (anchorAmount * v) / anchorVault);
}

/** Off-tolerance legs for the live hint: g_i - min > min / 100. */
export function offToleranceLegs(perLeg: bigint[]): number[] {
  if (perLeg.length === 0) return [];
  const min = perLeg.reduce((m, g) => (g < m ? g : m), perLeg[0]);
  const out: number[] = [];
  perLeg.forEach((g, i) => {
    if ((g - min) * 100n > min) out.push(i);
  });
  return out;
}
