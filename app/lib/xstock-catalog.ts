/**
 * Mock xStock catalog client (devnet demo universe).
 *
 * Reads GET /api/v1/xstocks/mock — the backend's 12-stock dev catalog
 * (backend/src/catalog/mockStocks.ts): display ticker, whitelist price_source
 * ("mock:<slug>") and a deterministic dev-catalog USD price explicitly labeled
 * `source: "dev-catalog"` — NOT live market data.
 *
 * Mint addresses are deliberately absent here: devnet mock mints are fresh
 * Token-2022 keypairs per deploy and must always come from API data
 * (/api/v1/whitelist), never hard-coded.
 *
 * This module is environment-neutral (no "use client") so both server
 * components (/etfs, /stock/[ticker]) and client components can use it.
 */

import { API_BASE, apiFetch } from "@/lib/api-client";

export { API_BASE };

export interface MockCatalogEntry {
  ticker: string;
  priceSource: string;
  /** Deterministic dev-catalog price (null only in the static fallback). */
  priceUsd: number | null;
}

/**
 * Static fallback for when the backend is unreachable: the 12 display tickers
 * of the dev catalog, no prices. Rendered honestly as "static dev list" —
 * symbols only, nothing fabricated.
 */
export const MOCK_XSTOCK_FALLBACK: readonly MockCatalogEntry[] = [
  { ticker: "TSLAx", priceSource: "mock:tsla", priceUsd: null },
  { ticker: "NVDAx", priceSource: "mock:nvda", priceUsd: null },
  { ticker: "AAPLx", priceSource: "mock:aapl", priceUsd: null },
  { ticker: "MSFTx", priceSource: "mock:msft", priceUsd: null },
  { ticker: "AMZNx", priceSource: "mock:amzn", priceUsd: null },
  { ticker: "GOOGLx", priceSource: "mock:googl", priceUsd: null },
  { ticker: "METAx", priceSource: "mock:meta", priceUsd: null },
  { ticker: "AMDx", priceSource: "mock:amd", priceUsd: null },
  { ticker: "COINx", priceSource: "mock:coin", priceUsd: null },
  { ticker: "MSTRx", priceSource: "mock:mstr", priceUsd: null },
  { ticker: "HOODx", priceSource: "mock:hood", priceUsd: null },
  { ticker: "SPYx", priceSource: "mock:spy", priceUsd: null },
] as const;

interface MockCatalogPayload {
  data?: { ticker?: unknown; priceSource?: unknown; priceUsd?: unknown }[];
  source?: unknown;
}

/**
 * Fetch the dev catalog. Returns null when the API is unreachable or the
 * payload has no usable rows — callers then fall back to MOCK_XSTOCK_FALLBACK
 * and must label the result as static.
 */
export async function fetchMockXStockCatalog(
  timeoutMs = 8000,
): Promise<MockCatalogEntry[] | null> {
  try {
    const res = await apiFetch("/api/v1/xstocks/mock", {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as MockCatalogPayload;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const entries: MockCatalogEntry[] = [];
    for (const row of rows) {
      if (typeof row.ticker !== "string" || !row.ticker) continue;
      const price =
        typeof row.priceUsd === "number" && Number.isFinite(row.priceUsd)
          ? row.priceUsd
          : null;
      entries.push({
        ticker: row.ticker,
        priceSource: typeof row.priceSource === "string" ? row.priceSource : "",
        priceUsd: price,
      });
    }
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}
