# xStocks Provider Envanteri — FolioX V0.1 Minimal

> Tek kaynaktan beslenen fiyat değil, **karşılaştırmalı** fiyat. Her ticker 3′lü: `xStock (Jupiter/on-chain) vs Gerçek Hisse (Yahoo) vs Endeks (Nasdaq/QQQ)`

## 1. Providerlar

| ID | Ad | Tip | Veri | Not |
|----|----|-----|------|-----|
| `backed` | Backed Finance | xStocks ihraçcısı | Token-2022 `ScaledUiAmount`, mint → ticker eşleşmesi | Whitelist `whitelist::add_mint` ile eklenir, multiplier 1.0→2.0 split |
| `jupiter` | Jupiter Price API v6 | On-chain fiyat | `price.jup.ag/v6/price?ids=mint` | NAV için, redeem’i asla gate’lemez |
| `yahoo` | Yahoo Finance | Gerçek hisse | `query2.finance.yahoo.com/v8/finance/chart/TSLA?interval=1d&range=1mo` | Nasdaq karşılaştırma için, CORS proxy gerekebilir |
| `nasdaq` | Nasdaq Benchmark | Endeks | Yahoo `QQQ` / `SPY` / `^IXIC` | Sepet benchmark’ı |

## 2. Ticker → Mint Eşleştirmesi (V0.1 ilk 4)

`backend/.env.example` PROGRAM_WHITELIST ile senkron. Gerçek mainnet mint’leri Backed docs’tan alınmalı; burada **mock/devnet** ile başla.

| Ticker | Gerçek Sembol | xStock Mint (mock) | Decimals | Provider |
|--------|---------------|--------------------|----------|----------|
| TSLAx | TSLA | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | 6 | backed | Solscan doğrulandı |
| AAPLx | AAPL | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | 6 | backed | Solscan doğrulandı |
| NVDAx | NVDA | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | 6 | backed | Solscan doğrulandı |
| SPYx | SPY | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | 6 | backed | Solscan doğrulandı |

Gerçek Backed mint’leri eklenince `scripts/createWhitelist.ts` ile `add_mint` çağrılır. Mock’lar `spl-token-2022` ile localnet’te oluşturulur.

## 3. Fiyat Kaynakları Detay

### Jupiter (on-chain xStock)
```
GET https://price.jup.ag/v6/price?ids=XTSLA...,XAAPL...
→ { data: { "XTSLA...": { price: 251.34 } } }
```
Fallback 0, cache 30s Redis `price:jupiter:{mint}`.

### Yahoo (gerçek)
```
GET https://query2.finance.yahoo.com/v8/finance/chart/TSLA?interval=1d&range=1mo
GET https://query2.finance.yahoo.com/v8/finance/chart/QQQ?interval=1d&range=1mo
→ chart.result[0].indicators.quote[0].close[] + timestamps
```
Backend proxy: `GET /api/v1/prices/yahoo?symbol=TSLA&range=1mo` → normalize eder. Header `User-Agent` gerekir, rate limit 2s.

### Karşılaştırma mantığı
- Her snapshot: `{ ts, jupiter, yahoo, diffBps = (jupiter - yahoo)/yahoo *10000 }`
- Depeg alarm: `|diffBps| > 200` (2%) → UI amber badge.
- Nasdaq benchmark: `QQQ` ile xStock fiyatını normalize (base 100, inception), yan yana çiz.

## 4. Minimal Şema Eklentisi

Mevcut `backend/src/db/schema.sql` üzerine:

```sql
CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT, type TEXT);
INSERT INTO providers VALUES ('backed','Backed Finance','xstock'),('jupiter','Jupiter','price'),('yahoo','Yahoo Finance','price'),('nasdaq','Nasdaq','index');

CREATE TABLE price_snapshots (
  mint TEXT, provider TEXT, price_usd NUMERIC, ts TIMESTAMPTZ, PRIMARY KEY (mint, provider, ts)
);
CREATE TABLE index_snapshots (symbol TEXT, price_usd NUMERIC, ts TIMESTAMPTZ, PRIMARY KEY (symbol, ts));
```

V0.1’de SQLite bile olur: `price_snapshots` + `index_snapshots` 1 dakikalık cron.

## 5. Öncelik

Bugün 1 saatte: **TSLA, NVDA, QQQ** 3’lüsü canlı; AAPL/SPY mock ile tamamla. Sonra 15 xStocks’a genişlet.

*LEGAL_REVIEW_REQUIRED: xStocks fiyatları Backed instrument’ıdır, doğrudan hisse fiyatı değildir.*
