/**
 * Price fetch — Jupiter Price API v6 (NAV only, never gates redeem)
 * Caches in Redis, feeds navEngine.
 */

export interface PriceMap { [mint: string]: number } // USD

export async function fetchPrices(mints: string[]): Promise<PriceMap> {
  if (mints.length === 0) return {};
  // V0: call Jupiter Price API; fallback to 1.0 for testing if API down
  const url = `https://price.jup.ag/v6/price?ids=${mints.join(",")}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`price fetch ${res.status}`);
    const json: any = await res.json();
    const out: PriceMap = {};
    for (const mint of mints) {
      out[mint] = json.data?.[mint]?.price ?? 0;
    }
    return out;
  } catch (e) {
    console.warn("price fetch failed, fallback 0", e);
    const out: PriceMap = {};
    for (const m of mints) out[m] = 0;
    return out;
  }
}

// For local testing / mocks
export function mockPrices(mints: string[], price = 100): PriceMap {
  const out: PriceMap = {};
  for (const m of mints) out[m] = price;
  return out;
}
