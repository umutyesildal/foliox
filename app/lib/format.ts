/**
 * FolioX display formatting helpers.
 *
 * Pure functions only (no DOM, no React, no process) so they can be unit-tested
 * with vitest as-is. Crypto display conventions:
 *  - token amounts: locale-aware grouping, abbreviated at >= 1M (1.2M, 3.4B, 5T)
 *  - USD: $ prefix, 2 decimals (4 for sub-$1 values, e.g. share prices)
 *  - bps <-> percent: on-chain weights/fees are bps (u16), UI copy uses %
 *  - addresses: truncated with ellipsis, rendered in Geist Mono by the caller
 *  - raw/scaled: raw is onchain truth (BigInt-safe strings), scaled is display
 *
 * Subscript zeros are intentionally NOT used — plain decimal strings only.
 */

const ABBREVIATIONS = [
  { threshold: 1e12, suffix: "T" },
  { threshold: 1e9, suffix: "B" },
  { threshold: 1e6, suffix: "M" },
] as const;

/** Non-finite values render as an em dash instead of "NaN"/"Infinity". */
export const NOT_A_NUMBER_LABEL = "—";

/**
 * Display casing for a ticker derived from a whitelist price_source slug
 * ("mock:nvda" → "NVDA"). All-lowercase slugs are uppercased; anything that
 * already has shape (mixed case like "TSLAx", or a mint fragment) passes
 * through unchanged. Display-only — never sent on-chain.
 */
export function prettyTicker(ticker: string): string {
  const t = ticker.trim();
  return /^[a-z0-9_-]+$/.test(t) ? t.toUpperCase() : t;
}

/**
 * Format a token amount for display. Locale-aware grouping below 1M,
 * single-decimal abbreviation at 1M/1B/1T (e.g. 12,345.5 -> "12,345.5",
 * 1_234_567 -> "1.2M").
 */
export function formatTokenAmount(
  value: number,
  options?: { locale?: string; maximumFractionDigits?: number },
): string {
  if (!Number.isFinite(value)) return NOT_A_NUMBER_LABEL;
  const locale = options?.locale ?? "en-US";
  const maximumFractionDigits = options?.maximumFractionDigits ?? 6;
  const abs = Math.abs(value);
  for (const { threshold, suffix } of ABBREVIATIONS) {
    if (abs >= threshold) {
      const scaled = value / threshold;
      const digits = abs >= 10 * threshold ? 0 : 1;
      return `${new Intl.NumberFormat(locale, {
        maximumFractionDigits: digits,
      }).format(scaled)}${suffix}`;
    }
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

/**
 * Format a USD amount. Values under $1 show up to 4 decimals (share price
 * convention, e.g. $1.2483); otherwise 2 decimals. Pass an explicit
 * maximumFractionDigits to override.
 */
export function formatUsd(
  value: number,
  options?: { locale?: string; maximumFractionDigits?: number },
): string {
  if (!Number.isFinite(value)) return NOT_A_NUMBER_LABEL;
  const locale = options?.locale ?? "en-US";
  const abs = Math.abs(value);
  const maximumFractionDigits =
    options?.maximumFractionDigits ?? (abs > 0 && abs < 1 ? 4 : 2);
  const minimumFractionDigits = Math.min(2, maximumFractionDigits);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

/** 100 bps = 1%. On-chain values are bps; UI copy uses percent. */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/** Inverse of bpsToPercent. 1% -> 100 bps. */
export function percentToBps(percent: number): number {
  return percent * 100;
}

/**
 * Percent string from bps, LOCALE-INDEPENDENT: 1666 bps -> "16.67%"
 * (always "." as the decimal separator). `toLocaleString` variants rendered
 * "1.666 bps" for 1666 bps in dot-grouping locales (de/tr/es) — an integer
 * weight misread as a fraction. Show this as the primary figure; put the raw
 * bps value (String(bps), no grouping) in a title/tooltip.
 */
export function formatBpsAsPercent(bps: number, fractionDigits = 2): string {
  if (!Number.isFinite(bps)) return NOT_A_NUMBER_LABEL;
  return `${(bps / 100).toFixed(fractionDigits)}%`;
}

/**
 * Format a bps value for display, e.g. 40 -> "40 bps". With `signed`, positive
 * values get an explicit "+" (drift convention: +40 bps / -25 bps).
 */
export function formatBps(
  bps: number,
  options?: { signed?: boolean; locale?: string; maximumFractionDigits?: number },
): string {
  if (!Number.isFinite(bps)) return NOT_A_NUMBER_LABEL;
  const locale = options?.locale ?? "en-US";
  const maximumFractionDigits = options?.maximumFractionDigits ?? 2;
  const sign = options?.signed && bps > 0 ? "+" : "";
  const body = new Intl.NumberFormat(locale, { maximumFractionDigits }).format(bps);
  return `${sign}${body} bps`;
}

/**
 * Truncate a base58 address for mono display: "AbCd…wXyZ" (4/4 by default).
 * Strings that already fit are returned unchanged.
 */
export function truncateAddress(address: string, leading = 4, trailing = 4): string {
  if (address.length <= leading + trailing + 1) return address;
  return `${address.slice(0, leading)}…${address.slice(-trailing)}`;
}

/**
 * Scaled display value from a raw Token-2022 amount.
 *
 * `scaled = raw x multiplier / 10^decimals` (AGENTS.md §7 — raw for transfers,
 * scaled for display). The computation is BigInt-exact for any multiplier with
 * a finite decimal representation (e.g. 1, 1000000, 0.95), so raw amounts far
 * beyond Number.MAX_SAFE_INTEGER never lose precision.
 *
 * @param raw        raw onchain amount: BigInt or integer string ("12345")
 * @param multiplier Scaled UI Amount multiplier (e.g. 1_000_000)
 * @param decimals   mint decimals (e.g. 6)
 * @returns plain decimal string with trailing zeros trimmed ("2", "1.2483")
 */
export function scaledFromRaw(
  raw: string | number | bigint,
  multiplier: number,
  decimals: number,
): string {
  const rawText = typeof raw === "bigint" ? raw.toString() : String(raw).trim();
  if (!/^-?\d+$/.test(rawText)) {
    throw new Error(`scaledFromRaw: raw must be an integer string, got "${rawText}"`);
  }
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`scaledFromRaw: decimals must be a non-negative integer, got ${decimals}`);
  }
  const multiplierText = String(multiplier).trim();
  if (!/^-?\d+(\.\d+)?$/.test(multiplierText) || !Number.isFinite(multiplier)) {
    throw new Error(
      `scaledFromRaw: multiplier must be a finite number, got "${multiplierText}"`,
    );
  }
  const dot = multiplierText.indexOf(".");
  const multiplierPrecision = dot === -1 ? 0 : multiplierText.length - dot - 1;
  const scalePower = decimals + multiplierPrecision;
  const scaledUnits =
    BigInt(rawText) * BigInt(multiplierText.replace(".", ""));
  // BigInt literals need an ES2020 target; BigInt(0) works on ES2017 too.
  const negative = scaledUnits < BigInt(0);
  const digits = (negative ? -scaledUnits : scaledUnits)
    .toString()
    .padStart(scalePower + 1, "0");
  const intPart = digits.slice(0, digits.length - scalePower);
  const fracPart = digits.slice(digits.length - scalePower).replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

/**
 * Format an "as of" timestamp for freshness labels: "2026-09-01 14:32 UTC".
 * Deterministic (UTC, ISO order) so server and client render identically.
 */
export function formatAsOf(input: Date | number | string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return "unknown";
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Coarse relative time for social timestamps ("just now", "5m ago", "3h ago",
 * "12d ago"); older than 30 days falls back to the UTC date. Client-side only
 * (social feeds are client components), `now` injectable for tests.
 */
export function formatRelativeTime(
  input: Date | number | string,
  now: Date = new Date(),
): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return NOT_A_NUMBER_LABEL;
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toISOString().slice(0, 10);
}
