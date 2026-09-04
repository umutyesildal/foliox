export const BPS_DENOM = 10_000;
export const SECONDS_PER_YEAR = 365 * 24 * 3600;

export function entryFee(gross: number, bps: number) {
  return Math.floor((gross * bps) / BPS_DENOM);
}
export function exitFee(shares: number, bps: number) {
  return Math.floor((shares * bps) / BPS_DENOM);
}
export function managementFee(supply: number, bps: number, elapsedSec: number) {
  return Math.floor((supply * bps * elapsedSec) / (BPS_DENOM * SECONDS_PER_YEAR));
}
export function splitFee(fee: number, creatorSplitBps = 9000) {
  const creator = Math.floor((fee * creatorSplitBps) / BPS_DENOM);
  return { creator, treasury: fee - creator };
}

// Tests: see programs/*/tests + backend unit tests
