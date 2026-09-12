/**
 * Yahoo Finance fetch — gerçek hisse + Nasdaq benchmark için
 * Not: Jupiter xStock fiyatını gate'lemez, sadece karşılaştırma için.
 */
export interface YahooCandle { ts: number; open: number; high: number; low: number; close: number; volume: number; }
export interface YahooSeries { symbol: string; candles: YahooCandle[]; }

const UA = "Mozilla/5.0 (compatible; Basalt/0.1)";

/**
 * Yahoo symbol allowlist: plain ticker characters only (e.g. TSLA, BRK-B,
 * ^IXIC). Anything else — slashes, query syntax, whitespace, percent-escapes —
 * is rejected before it can become part of the upstream URL.
 */
const YAHOO_SYMBOL_RE = /^[A-Za-z0-9.^\-=]{1,15}$/;

/** Upstream range/interval enums (query2 chart API); anything else throws. */
const ALLOWED_RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);
const ALLOWED_INTERVALS = new Set(["1m", "2m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo"]);

/** Upstream host + base path are compile-time constants — never interpolated. */
const YAHOO_CHART_ORIGIN = "https://query1.finance.yahoo.com";
const YAHOO_CHART_URL = YAHOO_CHART_ORIGIN + "/v8/finance/chart/";
/** Final-request pathname must be a plain encoded chart path (containment). */
const YAHOO_CHART_PATH_RE = /^\/v8\/finance\/chart\/[A-Za-z0-9._~!*'()%-]{1,32}$/;
const YAHOO_TIMEOUT_MS = 8000;

export async function fetchYahooSeries(symbol: string, range = "1mo", interval = "1d"): Promise<YahooSeries> {
  const result = await guardedChartResult(symbol, range, interval);
  const timestamps: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes: (number|null)[] = quote.close || [];
  const opens: (number|null)[] = quote.open || [];
  const highs: (number|null)[] = quote.high || [];
  const lows: (number|null)[] = quote.low || [];
  const volumes: (number|null)[] = quote.volume || [];
  const candles: YahooCandle[] = timestamps.map((ts, i) => ({
    ts: ts*1000,
    open: opens[i] ?? closes[i] ?? 0,
    high: highs[i] ?? closes[i] ?? 0,
    low: lows[i] ?? closes[i] ?? 0,
    close: closes[i] ?? 0,
    volume: volumes[i] ?? 0,
  })).filter(c => c.close > 0);
  return { symbol, candles };
}

/** Spot-quote shape from the chart meta block (quote provenance consumers). */
export interface YahooQuote {
  symbol: string;
  /** Latest regular-session price — chart meta `regularMarketPrice` (USD). */
  price: number;
  currency: string | null;
  /** Upstream market state, e.g. "REGULAR" / "CLOSED" / "PRE" (informational). */
  marketState: string | null;
}

/**
 * Guarded spot quote for one symbol: same guards as fetchYahooSeries (symbol
 * charset, range/interval allowlists, host + pathname containment, 8s
 * timeout), reading the chart meta `regularMarketPrice` — the quote Yahoo
 * serves even when the market is CLOSED. Throws on any upstream problem;
 * callers decide the fallback (never a fabricated price).
 */
export async function fetchYahooQuote(symbol: string): Promise<YahooQuote> {
  const result = await guardedChartResult(symbol, "1d", "1d");
  const meta = result.meta || {};
  const price = meta.regularMarketPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error(`yahoo no meta price for ${symbol}`);
  }
  const currency = typeof meta.currency === "string" ? meta.currency : null;
  const marketState = typeof meta.marketState === "string" ? meta.marketState : null;
  return { symbol, price, currency, marketState };
}

/**
 * Shared guarded chart request — ALL security guards live here and every
 * Yahoo read path (candles + spot quote) goes through this single funnel.
 * Throws with `yahoo <symbol> <status>` on non-2xx, "yahoo no result" on a
 * shapeless payload.
 */
async function guardedChartResult(symbol: string, range: string, interval: string): Promise<any> {
  // range: 1d,5d,1mo,3mo,6mo,1y  interval: 1m,5m,15m,1d
  if (!YAHOO_SYMBOL_RE.test(symbol)) {
    throw new Error(`yahoo: rejected symbol ${JSON.stringify(symbol.slice(0, 32))}`);
  }
  if (!ALLOWED_RANGES.has(range)) {
    throw new Error(`yahoo: unsupported range ${JSON.stringify(range.slice(0, 32))}`);
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    throw new Error(`yahoo: unsupported interval ${JSON.stringify(interval.slice(0, 32))}`);
  }
  const url = new URL(YAHOO_CHART_URL + encodeURIComponent(symbol));
  url.searchParams.set("interval", interval);
  url.searchParams.set("range", range);
  url.searchParams.set("includePrePost", "false");
  // Containment on the FINAL request URL: origin must equal the trusted Yahoo
  // host and the pathname must be a plain chart path — the request is refused
  // otherwise, regardless of what the inputs were.
  if (url.origin !== YAHOO_CHART_ORIGIN) {
    throw new Error("yahoo: refusing request URL outside the Yahoo chart host");
  }
  if (!YAHOO_CHART_PATH_RE.test(url.pathname)) {
    throw new Error("yahoo: refusing unexpected request pathname");
  }
  // Short timeout so a hung upstream cannot stall the API event loop path.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`yahoo ${symbol} ${res.status}`);
  const json: any = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`yahoo no result for ${symbol}`);
  return result;
}

export async function fetchYahooPrice(symbol: string): Promise<number | null> {
  try {
    const s = await fetchYahooSeries(symbol, "1d", "1d");
    return s.candles.length ? s.candles[s.candles.length-1].close : null;
  } catch (e) {
    console.warn("yahoo price failed", symbol, e);
    return null;
  }
}

/** Normalize to base 100 for overlay comparison */
export function normalizeBase100(candles: YahooCandle[]): { ts:number; value:number }[] {
  if (!candles.length) return [];
  const base = candles[0].close || 1;
  return candles.map(c => ({ ts: c.ts, value: (c.close / base) * 100 }));
}

export function toOHLC(candles: YahooCandle[]): { date: Date; open:number; high:number; low:number; close:number; volume:number }[] {
  return candles.map(c=>({ date: new Date(c.ts), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
}
