# Basalt — X (Twitter) Profile Pack

_Rendered 2026-09-12 from `twitter-pfp.html` + `twitter-banner.html` (edit and
re-render: `python3 -m http.server 8901` from the repo root, then screenshot
the pages at their exact viewport sizes)._

## Upload files

| asset | file | size |
|---|---|---|
| Profile photo | `twitter-pfp-400.png` | 400×400 (X crops circular; mark is centered with safe margins) |
| Banner | `twitter-banner-1500x500.png` | 1500×500 (lockup centered, clear of the bottom-left avatar overlap zone) |

## Name (display name, ≤50 chars)

**Recommended:** `Basalt`

Alternative (discoverability-first): `Basalt | xStocks Baskets on Solana`

## Handle (≤15 chars, check availability in order)

1. `@BasaltOnSolana` (14)
2. `@BasaltLabs` (11)
3. `@basalt_fi` (10)
4. `@BasaltProtocol` (15)

## Bio (≤160 chars)

**EN (recommended — consumer voice, social-trading first), 156 chars:**

```
Create your basket of tokenized stocks on Solana. One token, your thesis. Follow top traders — receipts, not screenshots. Coming soon. Not financial advice.
```

**TR alternative, 133 chars:**

```
Basalt — gerçek hisselerden tek token. Solana'da xStocks ile onchain strateji sepetleri. Devnet'te canlı. Yatırım tavsiyesi değildir.
```

Voice rules kept: no "ETF/fund/guaranteed/safe", no hype words, no emojis, no
exclamation marks (brand.md). No devnet mention in the consumer-facing bio —
"Coming soon" carries the launch tease; devnet proof lives in build-log replies.

## Location field (≤30)

`On Solana`

## Website field

Leave empty until one of these is live, then set (first available):
1. The app's public demo URL (deploy before/during Stocklana)
2. GitHub repo URL when public
3. A landing page (e.g. `basalt.link` style placeholder you own)

## Pinned tweet draft (launch, EN — consumer voice, no devnet)

**Recommended (239 chars) — two-sided hook:**

```
Stocks went on-chain. Portfolios didn't.

Now you can buy a top trader's basket — or create your own from tokenized stocks. Either way you hold one token, and every trade settles on-chain.

Receipts, not screenshots. Coming soon on Solana.
```

**Alternative — "be your own" (234 chars):**

```
Stocks went on-chain. Portfolios didn't.

Follow top traders, buy their baskets — or be your own and create one from tokenized stocks like TSLAx, NVDAx, SPYx. One token either way.

Every trade settles on-chain. Coming soon on Solana.
```

**Alternative — creator-first (258 chars):**

```
Stocks went on-chain. Portfolios didn't.

Create your basket from tokenized stocks — TSLAx, NVDAx, SPYx — and hold it as one token.

Or skip the work: follow top traders and buy their baskets. Either way, every trade settles on-chain.

Coming soon on Solana.
```

Wording rules for this surface: end-user language only ("create your
basket" / "buy their baskets", never "mint"; no oracle/redemption/pro-rata
jargon — protocol details live in thread replies). **Never "fund manager" /
"fund" / "ETF"** — the standing legal ban (AGENTS.md §1: the product is not
a fund; "trader" + "basket" carry the same meaning). "Coming soon" instead
of devnet status; legal ban on guaranteed/safe/advice language still
absolute.

## Founder tweet (personal account, EN — post right after the launch tweet)

**Standard (271 chars):**

```
Been building: Basalt — your basket of tokenized stocks on Solana, held as one token.

Buy a top trader's basket or create your own. Every trade settles on-chain: receipts, not screenshots.

Shipping it at the Stocklana hackathon this week. Coming soon → @BasaltOnSolana
```

**Shorter (210 chars):**

```
New build: Basalt.

Your basket of tokenized stocks on Solana — one token. Or skip the line and buy a top trader's basket, receipts on-chain.

In the Stocklana hackathon this week. Coming soon → @BasaltOnSolana
```

**Short teaser (user preference — the launch tweet explains, this just points):**

107 chars:
```
Cooking something → @BasaltOnSolana

Baskets of tokenized stocks on Solana. Stocklana hackathon, this week.
```

82 chars:
```
This week's build → @BasaltOnSolana

Tokenized stock baskets on Solana. One token.
```

31 chars:
```
Building this → @BasaltOnSolana
```

Posting order: brand account launch tweet first, then this from the personal
account as a quote-reply or standalone with the handle pointer — personal
tweet feeds followers into the new account. Replace `@BasaltOnSolana` with
the handle actually secured.

Follow-up replies to thread (build-in-public cadence for Stocklana):
1. Devnet evidence — mint/redeem/fee txs, NAV reconciliation numbers (this is
   where the devnet proof lands, not the launch tweet).
2. The mark — why basalt columns = weights (design-basalt-v1 §1).
3. What ships during hackathon week (hardening + demo), tagging @solana
   @colosseum on the submission announcement only.

## Stocklana submission pointer

Register at hackathons.solana.com/hackathons/stocklana — submissions close
Sept 18, 4:00pm ET. Include GitHub + live demo + video links.
