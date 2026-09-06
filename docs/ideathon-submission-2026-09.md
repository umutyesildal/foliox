# FolioX — Create an index. Own your thesis.

**Category:** RWA / Tokenisation (primary) · DeFi (secondary) · 📺 **1-minute walkthrough (Loom):** _link added after recording_

## The problem

Tokenized equities grew **+422%** in 2026, and Kraken's xStocks alone cleared **$25B+** in volume in eight months. Thousands of people now hold tokenized stocks on Solana, yet there are **0 ways to compose them** into a thesis. Off-chain index products exist, but they come wrapped in exactly the rails blockchains were built to remove: broker custody, T+1 settlement, market hours, and an operator who can gate your exit.

## The idea

FolioX is the composition layer: bundle xStocks (Backed tokenized equities, native Token-2022) into strategy baskets with immutable weights and capped fees — 90% of fees go to the basket creator.

1. **Create** — pick the constituents and weights; once deployed they are immutable forever.
2. **Mint** — deposit the underlying stocks in-kind and receive one SPL share token.
3. **Redeem** — burn it anytime and get your stocks back, permissionlessly, 24/7, self-custodied.

## Why blockchain

The core promise — you can always take your stocks back without anyone's permission — can only be enforced by an on-chain program. It is proven on devnet: `redeem_in_kind` succeeded while a constituent token was paused. No oracle, no operator, no pause button.

## Already working on devnet

Three Anchor programs are deployed, whitelisting 12 devnet mock xStocks (self-minted — no official devnet xStocks exist; real mainnet integration is milestone one) and powering 3 live baskets with NAV priced from real market data. The builder is user #1: this week he minted and redeemed a basket live through the real UI with a real wallet. The flagship 6-constituent MAG SIX basket is on-chain here: [explorer.solana.com/address/CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo?cluster=devnet](https://explorer.solana.com/address/CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo?cluster=devnet)

## Next — the global Solana Hackathon

1. Real mainnet xStocks integration — 8 decimals + transfer hooks.
2. Upgrade authority to a Squads multisig + external security review.
3. Mainnet-beta soft launch — capped TVL, first creators.

## Team

Solo builder, full-stack Solana, based in Germany, ships weekly.
