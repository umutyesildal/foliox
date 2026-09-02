/**
 * Shared wizard state types for the Create flow. Owned by the create page;
 * step components receive slices of this state as props.
 */

/** Row from GET /api/v1/whitelist (backend whitelisted_mints table). */
export interface WhitelistRow {
  mint: string;
  decimals: number;
  status: string;
  price_source: string | null;
  multiplier: number;
  source?: string | null;
  asOf?: string | null;
}

/** Row from GET /api/v1/prices/compare — reference estimate for seed preview. */
export interface PriceCompareRow {
  ticker: string;
  mint: string;
  jupiter: number | null;
  yahoo: number | null;
  diffBps: number | null;
}

export interface ConstituentDraft {
  mint: string;
  /** Display ticker ("TSLAx") or a short mint label when no price source exists. */
  ticker: string;
  decimals: number;
  weightBps: number;
  /** Raw Token-2022 seed amount (on-chain u64 units). */
  seedRaw: bigint;
  /** Reference price used by the seed USD example (null when unavailable). */
  priceRef?: number | null;
}

/** The four legal acknowledgments required before deploy (step 5). */
export interface LegalAcknowledgments {
  notAdvice: boolean;
  jurisdiction: boolean;
  structuredInstrument: boolean;
  creatorNotAdviser: boolean;
}

export interface WizardDraft {
  name: string;
  description: string;
  constituents: ConstituentDraft[];
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  legal: LegalAcknowledgments;
}

export const WEIGHTS_DENOMINATOR = 10_000;

/** Ticker from the price source label ("jupiter:TSLAx"), else short mint. */
export function tickerFromRow(row: WhitelistRow): string {
  const source = row.price_source ?? "";
  const colon = source.indexOf(":");
  const candidate = colon >= 0 ? source.slice(colon + 1).trim() : source.trim();
  if (candidate.length >= 2 && candidate.length <= 12) return candidate;
  return `${row.mint.slice(0, 6)}…`;
}

/** Equal-weight bps with the remainder on the last constituent (exact 10,000). */
export function equalWeights(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(WEIGHTS_DENOMINATOR / count);
  const weights = Array.from({ length: count }, () => base);
  weights[count - 1] += WEIGHTS_DENOMINATOR - base * count;
  return weights;
}

/**
 * Largest-remainder normalization to exactly 10,000 bps. Deterministic:
 * remainder goes to the largest fractional parts (ties broken by index).
 */
export function normalizeWeights(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return equalWeights(weights.length);
  const exact = weights.map((w) => (w * WEIGHTS_DENOMINATOR) / sum);
  const floored = exact.map((v) => Math.floor(v));
  let remainder = WEIGHTS_DENOMINATOR - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}

/**
 * Parse a human token-unit input ("1.5", "0.000001") into raw integer units.
 * Returns null for invalid/over-precise input. BigInt-exact, no float math.
 */
export function parseTokenUnitsToRaw(
  input: string,
  decimals: number,
): bigint | null {
  const text = input.trim();
  if (!/^\d*(\.\d*)?$/.test(text) || text === "" || text === ".") return null;
  const dot = text.indexOf(".");
  const fracDigits = dot === -1 ? 0 : text.length - dot - 1;
  if (fracDigits > decimals) return null;
  const whole = dot === -1 ? text : text.slice(0, dot);
  const frac = dot === -1 ? "" : text.slice(dot + 1);
  const digits = (whole || "0") + frac.padEnd(decimals, "0");
  const raw = BigInt(digits === "" ? "0" : digits);
  return raw;
}

/** Raw integer units to a human token-unit string (trailing zeros trimmed). */
export function formatRawAsTokenUnits(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toString();
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}
