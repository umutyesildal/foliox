# Basalt — Idea Context (pitch-deck input)

> Prepared 2026-09-03 for the `create-pitch-deck` skill. Sources: `basalt_build_prompt.md`, `AGENTS.md`, `docs/basalt-v0-spec.md`, owner decisions.

## Product

**Basalt** — a Solana dApp where anyone can create and hold tokenized strategy baskets ("custom ETFs", never called ETFs in product copy) built from **xStocks** — Backed Finance's Token-2022 wrapped equities/ETFs (TSLAx, AAPLx, NVDAx, SPYx…).

**Tagline:** "Create an index. Own your thesis."

**One-liner:** Create an onchain basket of tokenized stocks in minutes — immutable weights, capped fees, permissionless redemption, no broker.

## Problem

- Tokenized equities exist (Backed xStocks, Ondo) but there is **no consumer layer to compose them** — users can buy single tokenized stocks but cannot bundle them into a personal index.
- Traditional ETFs: T+1/T+2 settlement, broker custody, market-hours-only, no transferability, NAV published daily.
- Existing onchain baskets (Set Protocol et al.) are EVM-only; Solana has no equivalent for tokenized-equity indices.

## Solution

1. **Stocks** — browse tokenized stocks across providers (live prices, sparklines).
2. **Tokenized ETFs** — the listings + education on how they differ from traditional ETFs (settlement, access, ownership, transferability, transparency).
3. **Baskets** — pick 2–20 tokenized stocks, fix weights in basis points, cap fees, deploy an immutable vault in one transaction. One share token, pro-rata ownership, oracle-free permissionless redemption (burn shares → receive the underlying tokens, anytime — even if the "protocol team" disappears).
4. Fees (entry ≤3%, exit ≤1%, management ≤3%/yr) split 90/10 creator/treasury — creators earn from their baskets.

## Why now

- xStocks launched on Solana mainnet (real Token-2022 mints, ScaledUiAmountConfig, transfer hooks) — the underlying layer is live and liquid.
- Tokenized-equity volume is growing; composition/index layer is the natural next stratum (the "Set Protocol moment" for tokenized equities).
- Solana's Token-2022 extensions (ScaledUiAmount, transfer hooks) finally make equity-grade token mechanics possible on-chain.

## Differentiators

- **Immutable by design** — weights/fees can never change after deploy (no rug-by-rebalance).
- **Oracle-free, permissionless redemption** — structurally proven (no whitelist/oracle/pauser account exists in the redeem path; source-level tested).
- **Self-custodial** — every share = pro-rata claim on real tokens in a PDA vault; backend never signs.
- **Creator economy** — anyone can publish a basket and earn 90% of its fees.

## Status (2026-09-03)

- **Protocol:** 3 Anchor programs, real Token-2022 CPIs, localnet E2E 8/8 PASS (deploy → whitelist → basket → mint → redeem → fee accrual). 178 Rust tests.
- **Backend:** real indexer (event decode, holdings sync, ScaledUiAmount multiplier), exact BigInt NAV engine, REST API with provenance markers. 392 TS tests.
- **Frontend:** new IA (Home / Stocks / ETFs / Baskets / Create wizard / Buy+Redeem / Portfolio), Roman-empire identity branch, monochrome+ethereal design system. Owner feedback rounds 1–4 applied.
- **Devnet:** paused on faucet funding (all airdrop routes exhausted; staged rerun ready). Mainnet xStock mints identified (real decimals: 8).

## Ask / next steps

- Complete devnet E2E (funding) → public demo.
- Legal review (strategy-basket positioning, jurisdiction controls).
- Mainnet-beta with capped TVL + attribution-complete xStock integration (8 decimals).

## Voice guardrails (for deck copy)

Never: ETF, fund, guaranteed, safe, financial advice, we manage your money. Always: strategy basket, index basket, onchain equity basket, xStocks-backed strategy token. `LEGAL_REVIEW_REQUIRED` items pending counsel.
