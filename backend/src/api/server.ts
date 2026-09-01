/**
 * Minimal API server — spec §8 + V0.1 price comparison
 * Run: npx tsx backend/src/index.ts  (PORT=3001)
 */
import http from "http";
import { comparePrices, getChartSeries, TICKER_MINTS, YAHOO_MAP } from "../workers/priceCompare";
import { fetchYahooSeries } from "../workers/yahooFetch";

export interface BasketRow {
  pubkey: string;
  creator: string;
  nav: number;
  supply: number;
  sharePrice: number;
}

const baskets: BasketRow[] = [];

export function createHandler() {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }

    // --- Health ---
    if (url.pathname === "/api/v1/health" && req.method === "GET") {
      res.end(JSON.stringify({ ok: true, version: "0.1.0", ts: new Date().toISOString() }));
      return;
    }

    // --- Providers ---
    if (url.pathname === "/api/v1/providers" && req.method === "GET") {
      res.end(JSON.stringify({ data: [
        { id:"backed", name:"Backed Finance", type:"xstock", mints: Object.entries(TICKER_MINTS).map(([ticker,mint])=>({ticker,mint, decimals:6, status:"Active", priceSource:`jupiter:${ticker}`})) },
        { id:"jupiter", name:"Jupiter Price v6", type:"price", url:"https://price.jup.ag/v6/price" },
        { id:"yahoo", name:"Yahoo Finance", type:"price", url:"https://query2.finance.yahoo.com" },
        { id:"nasdaq", name:"Nasdaq Benchmark (QQQ)", type:"index", symbol:"QQQ" },
      ]}));
      return;
    }

    // --- xStocks list ---
    if (url.pathname === "/api/v1/xstocks" && req.method === "GET") {
      const data = Object.entries(TICKER_MINTS).map(([ticker,mint])=>({
        ticker, mint, yahooSymbol: YAHOO_MAP[ticker], decimals:6, provider:"backed", status:"Active"
      }));
      res.end(JSON.stringify({ data }));
      return;
    }

    // --- Price compare: xStock (Jupiter) vs gerçek (Yahoo) ---
    // GET /api/v1/prices/compare?tickers=TSLAx,NVDAx
    if (url.pathname === "/api/v1/prices/compare" && req.method === "GET") {
      const tickersParam = url.searchParams.get("tickers");
      const tickers = tickersParam ? tickersParam.split(",") : undefined;
      const data = await comparePrices(tickers);
      res.end(JSON.stringify({ data, ts: new Date().toISOString(), note: "diffBps = (jupiter - yahoo)/yahoo*10000, LEGAL: xStock is structured instrument" }));
      return;
    }

    // --- Chart series: xStock + Yahoo + Nasdaq overlay ---
    // GET /api/v1/prices/chart?tickers=TSLAx&range=1mo
    if (url.pathname === "/api/v1/prices/chart" && req.method === "GET") {
      const ticker = url.searchParams.get("ticker") || "TSLAx";
      const range = url.searchParams.get("range") || "1mo";
      const series = await getChartSeries(ticker, range);
      res.end(JSON.stringify({ data: series }));
      return;
    }

    // --- Yahoo proxy: GET /api/v1/prices/yahoo?symbol=TSLA&range=1mo ---
    if (url.pathname === "/api/v1/prices/yahoo" && req.method === "GET") {
      const symbol = url.searchParams.get("symbol") || "TSLA";
      const range = url.searchParams.get("range") || "1mo";
      try {
        const s = await fetchYahooSeries(symbol, range, "1d");
        res.end(JSON.stringify({ data: s }));
      } catch (e:any) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error:{code:"YAHOO_FETCH_FAILED", message: String(e.message||e)}}));
      }
      return;
    }

    // --- Market overview: Nasdaq (QQQ, SPY, DIA) ---
    if (url.pathname === "/api/v1/market/overview" && req.method === "GET") {
      const range = url.searchParams.get("range") || "1mo";
      const symbols = ["QQQ","SPY","DIA","^IXIC"];
      const results = await Promise.all(symbols.map(s=> fetchYahooSeries(s, range, "1d").catch(()=>({symbol:s,candles:[]})) ));
      // compute % change from first close
      const overview = results.map(r=>{
        const first = r.candles[0]?.close ?? 0;
        const last = r.candles[r.candles.length-1]?.close ?? 0;
        const changePct = first? (last-first)/first*100 : 0;
        return { symbol:r.symbol, first, last, changePct, candles:r.candles, count:r.candles.length };
      });
      res.end(JSON.stringify({ data: overview, range }));
      return;
    }

    // --- Legacy baskets ---
    if (url.pathname === "/api/v1/baskets" && req.method === "GET") {
      const sort = url.searchParams.get("sort") || "aum";
      res.end(JSON.stringify({ data: baskets, sort }));
      return;
    }
    if (url.pathname.startsWith("/api/v1/baskets/") && req.method === "GET") {
      const pubkey = url.pathname.split("/")[3];
      const b = baskets.find(x => x.pubkey === pubkey);
      if (!b) { res.statusCode = 404; res.end(JSON.stringify({ error: { code: "NOT_FOUND" } })); return; }
      res.end(JSON.stringify({ data: b }));
      return;
    }
    if (url.pathname === "/api/v1/quotes/zap-in" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        const { basket, amountUSDC, slippageBps } = JSON.parse(body || "{}");
        res.end(JSON.stringify({ basket, amountUSDC, slippageBps, legs: [], warning: "sequential swaps, not atomic" }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
  };
}

if (process.argv[1]?.endsWith("server.ts")) {
  const handler = createHandler();
  http.createServer(handler).listen(3001, () => console.log("FolioX API on :3001 (providers + price compare)"));
}
