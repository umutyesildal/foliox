/**
 * NAV Engine — Σ(scaled * price), share price, drift
 * Prices from Jupiter Price API v6 (NAV only, never gates redeem)
 */
export interface NavInput {
  scaledAmounts: number[]; // per constituent
  prices: number[]; // USD per scaled unit
  supply: number; // share supply (6 decimals -> human)
  targetWeightsBps: number[];
}

export function computeNav(scaledAmounts: number[], prices: number[]): number {
  let nav = 0;
  for (let i = 0; i < scaledAmounts.length; i++) nav += scaledAmounts[i] * (prices[i] ?? 0);
  return nav;
}

export function computeSharePrice(nav: number, supply: number): number {
  if (supply === 0) return 0;
  return nav / supply;
}

export function computeDrift(scaledAmounts: number[], targetBps: number[]): number[] {
  const total = scaledAmounts.reduce((a, b) => a + b, 0);
  if (total === 0) return targetBps.map(() => 0);
  return scaledAmounts.map((s, i) => {
    const actualBps = Math.round((s / total) * 10_000);
    return actualBps - targetBps[i];
  });
}

// Example (§5): TSLA 50/30/20, scaled 500/300/200, prices 250/100/180
// NAV = 500*250 +300*100 +200*180 =125k+30k+36k=191k; supply 10 => price 19.1k
