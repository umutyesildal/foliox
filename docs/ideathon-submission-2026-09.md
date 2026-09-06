# FolioX

**Create an index. Own your thesis.**

- **Category:** RWA / Tokenisation (primary) · DeFi (secondary)
- **Status:** Live on Solana devnet — open source, solo-built, shipping weekly
- **Full submission document:** this file. Pitch deck (PDF): [`FolioX-Pitch-Deck.pdf`](../FolioX-Pitch-Deck.pdf). Devnet evidence pack: [`docs/devnet-live-2026-09-04.md`](devnet-live-2026-09-04.md)

---

## The problem

Tokenized equities exploded in 2026 — **+422% growth** — and Kraken's xStocks alone cleared **$25B+ in volume** in eight months. Thousands of people now hold tokenized stocks on Solana.

But there are **0 ways to compose them**. You can buy NVDAx. You can buy AAPLx. You cannot express a thesis like "Mega-cap tech, weighted 40/32/28" as a single self-custodied position. Composition — the layer that turns individual tokens into an index — simply does not exist on Solana today.

Off-chain, index products exist, but they are wrapped in exactly the rails blockchains were built to remove: T+1 settlement, broker custody, market hours, geographic restrictions, and an operator who can gate your exit.

## The idea

FolioX is the **composition layer for tokenized stocks on Solana**. Anyone can bundle xStocks (Backed Finance tokenized equities, native Token-2022 mints) into a **strategy basket** with **immutable weights** and **capped fees** (entry 1% / exit 0.5% / management 2%/yr — **90% of fees go to the basket creator**), and receive one SPL share token.

Three steps, plain sentences:

1. **Create** — pick the constituents and weights. Once deployed, the weights are immutable forever. No rug-by-rebalance.
2. **Mint** — deposit the underlying stocks in-kind. Receive one share token representing the basket.
3. **Redeem** — burn the share token anytime and get back the underlying stocks. Permissionless, 24/7, self-custodied. No oracle, no operator, no pause button.

The basket is **oracle-free** (in-kind accounting, no price feeds in the trust path) and **self-custodied** (the share token sits in your wallet and composes with the rest of DeFi).

## Why blockchain is necessary

This is not a database with a crypto sticker. The core promise — **you can always burn your shares and take back the underlying stocks without anyone's permission** — can only be enforced by an on-chain program.

**It is proven on devnet:** `redeem_in_kind` succeeded **while a constituent token was PAUSED**. No oracle, no operator, no pause button. Remove the chain and this guarantee does not exist. Traditional ETF rails (T+1, broker custody, market hours, geography) cannot replicate it.

## Already built (this is not a whitepaper)

Everything below is on Solana devnet today, RPC-verifiable, documented in the [devnet evidence pack](devnet-live-2026-09-04.md) in this repo:

- **3 Anchor programs deployed** at their declared IDs:
  - `whitelist` — [FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS](https://explorer.solana.com/address/FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS?cluster=devnet)
  - `basket_factory` — [3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF](https://explorer.solana.com/address/3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF?cluster=devnet)
  - `basket` — [6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k](https://explorer.solana.com/address/6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k?cluster=devnet)
- **12 whitelisted devnet mock xStocks** (TSLAx … SPYx, Token-2022 + ScaledUiAmount).
- **3 live baskets**, including the 6-constituent MAG SIX — [CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo](https://explorer.solana.com/address/CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo?cluster=devnet) — built through versioned transactions + address lookup tables.
- **NAV priced from real market data** (Yahoo) with honest source labels.
- **Read-only indexer + NAV engine + fee crank** that only build **unsigned** transactions — the backend never signs. Keys never touch the server.
- **657 tests green**: 178 Rust (`cargo test`) + 479 backend.
- **48+ confirmed devnet transactions.**

### User number 1

The strongest signal we can offer: **the builder is user #1.** This week he bought and redeemed a 6-stock basket live on devnet, through the real UI, with a real wallet — and his portfolio is reconciled on-chain by the indexer.

- Buy tx: [`5aDq9yfftyj5xSXqtNHX3Q7caiiBLPfvGu1r6Fs7csNM6AQ3YUuZ8oeWB2Zx4EVqAj91PHm186AwtfFMLctZH9Z`](https://explorer.solana.com/tx/5aDq9yfftyj5xSXqtNHX3Q7caiiBLPfvGu1r6Fs7csNM6AQ3YUuZ8oeWB2Zx4EVqAj91PHm186AwtfFMLctZH9Z?cluster=devnet)
- Redeem tx: [`23TPhP6GkjDCTKKutPHoJ5fPmLiCQ7ZuwLtFmJMKCJPsRxYPZDdNxZM51tRqGXuuPowM494RJ44FSyYEqfwSZ8ri`](https://explorer.solana.com/tx/23TPhP6GkjDCTKKutPHoJ5fPmLiCQ7ZuwLtFmJMKCJPsRxYPZDdNxZM51tRqGXuuPowM494RJ44FSyYEqfwSZ8ri?cluster=devnet)

### Devnet honesty

The 12 whitelisted tokens are **self-minted mocks** — no official devnet xStocks exist. Real mainnet xStocks integration is milestone #1 of the build plan. We state this plainly because the architecture does not change: both are Token-2022 mints; mainnet adds 8 decimals and transfer hooks, both already accounted for in the roadmap.

## What we build during the global Solana Hackathon

1. **Real mainnet xStocks integration** — 8 decimals + transfer hooks.
2. **v0 transactions + ALT everywhere** — the one-press UX, no wire-limit ceilings.
3. **Squads multisig** for program upgrade authority.
4. **Keeper service** to submit the fee crank's unsigned transactions.
5. **External security review.**
6. **Mainnet-beta soft launch with capped TVL** and the first basket creators.

## Team

Solo builder, full-stack Solana, based in Germany, ships weekly. Every claim in this document links to on-chain evidence or source code in this public repo.
