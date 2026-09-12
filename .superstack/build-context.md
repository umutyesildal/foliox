# Basalt — Build Context (pitch-deck input)

> 2026-09-03. Companion to `idea-context.md`. Sources: AGENTS.md, plan.md §6/§8c, verified worker reports.

## Stack

- **Protocol:** Anchor 0.30.1 + SPL Token-2022. 3 programs: `whitelist` (Token-2022 ownership + decimals verification), `basket_factory` (2–20 constituents, weights sum 10,000 bps, fee caps 300/100/300 bps, atomic seed, genesis 1M shares via temp-authority handoff), `basket` (mint_in_kind 4n remaining-accounts contract with pause gate, redeem_in_kind 3n — permissionless, oracle-free, structurally tested; accrue_management_fee). All transfers `transfer_checked`, RAW only.
- **Backend:** Node 20 + TS strict + PostgreSQL + optional Redis. Anchor event decoder (Borsh), holdings sync with ScaledUiAmountConfig multiplier (f64 per spl-token 0.4.15), exact BigInt fixed-point NAV engine, basket_rankings matview, event-driven user_positions writer (idempotent position_events ledger), unsigned fee-crank tx builder (backend never signs). REST /api/v1 with source/asOf provenance; Jupiter zap quotes; honest 503/404 states.
- **Frontend:** Next.js 15, React 19, Tailwind 3.4, verified-official Bklit chart registry (@visx-backed), @solana/wallet-adapter (Phantom/Solflare), monochrome + Roman-identity design system (Cinzel display, laurel monogram, imperial/pompeian accents), 15 routes, tsc 0 errors.

## Verification

- 178 Rust tests (protocol math + security properties; pro-rata never-over-withdraw, fee caps, genesis inflation-attack, redeem gate-free structural assertion).
- 392 backend TS tests (event decode fixtures, BigInt NAV exactness, positions ledger idempotency, API contracts).
- Frontend: tsc 0 errors, next build green (15 routes, no ignored errors), browser-verified dark/light + 390px.
- Localnet E2E: 8/8 steps PASS, twice consecutive (validator → deploy → whitelist → basket → mint/redeem → accrue → health).

## Program IDs (deploy keypairs verified on-curve)

- whitelist `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS`
- basket_factory `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF`
- basket `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k`

## Known gaps (honest)

- Devnet E2E paused on faucet funding (staged rerun; ~12 SOL needed).
- CPI paths verified via cargo check + pure-math tests, not yet on a live validator.
- ≥5-constituent baskets need Address Lookup Tables (tx >1232 B) — V1 item.
- Legal copy pending counsel (strategy-basket positioning).
