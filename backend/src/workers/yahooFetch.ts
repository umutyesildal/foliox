/**
 * Yahoo Finance fetch — gerçek hisse + Nasdaq benchmark için
 * Not: Jupiter xStock fiyatını gate'lemez, sadece karşılaştırma için.
 */
export interface YahooCandle { ts: number; open: number; high: number; low: number; close: number; volume: number; }
export interface YahooSeries { symbol: string; candles: YahooCandle[]; }

const UA = "Mozilla/5.0 (compatible; FolioX/0.1)";

export async function fetchYahooSeries(symbol: string, range = "1mo", interval = "1d"): Promise<YahooSeries> {
  // range: 1d,5d,1mo,3mo,6mo,1y  interval: 1m,5m,15m,1d
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`yahoo ${symbol} ${res.status}`);
  const json: any = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`yahoo no result for ${symbol}`);
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
