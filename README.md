# FolioX — xStocks Strategy Baskets on Solana

> “Create an index. Own your thesis.” — Onchain strategy baskets powered by xStocks.
> V0 spec: `docs/foliox-v0-spec.md` (normative product constraints). Execution plan: `plan.md`.
> Current state: scaffold/prototype with documented gaps; not localnet-ready or production-ready.

## Stack

- **Solana programs (Anchor 0.30):** `whitelist`, `basket_factory`, `basket` (optional `zap_router` V0 = client Jupiter sequential)
- **Backend:** TypeScript + Node + PostgreSQL + Redis + BullMQ (indexer, NAV, rankings, Jupiter quotes) — *convenience only, redeem remains permissionless*
- **Frontend:** Next.js 15 + Tailwind 3.4 + shadcn + **bklit UI** (`@bklit` registry `area-chart`/`line-chart`/`bar-chart`/`candlestick`) + wallet-adapter — **Hep bklit kullanılacak** (https://bklit.com/docs/installation), düz HTML/recharts yasak
- **Token:** SPL Token-2022 — raw transfers on-chain, `scaled = raw × multiplier` for display/NAV

## Quick Start (read-only checks)

The workspace has been scaffolded manually and the verified checks are the current source of truth:

```bash
cargo build
cargo test

# Or with anchor CLI
anchor build
anchor test
```

## Programs

| Program | ID (localnet) | Description |
|---------|---------------|-------------|
| `whitelist` | `bdEDPr9KGtkSABS8Sg3gWeJKyQEaTQVaBRvCu38YMNz` | `init_config`, `add_mint`, `pause_mint`, `unpause_mint`, `transfer_authority` |
| `basket_factory` | `sXShikYX7G5n3S3qp78RWQBxh2YJARLvufiCoaxjAyq` | `init_factory`, `create_basket` validation scaffold; seed/share behavior still requires implementation |
| `basket` | `37VPGtd57kXJ1HvH1xvdZr1y3s4KXj9pP2o6GdYLgbb1` | math and instruction scaffold; real transfer/mint/burn behavior still requires implementation |

See `docs/foliox-v0-spec.md` §2-6 for account model, instruction args, mint/redeem math, fee math.

## Token-2022 Accounting

- On-chain: **raw** (`transfer_checked` with `decimals` from whitelist)
- Off-chain: `scaled = raw × multiplier` (via `ScaledUiAmountConfig` extension)
- Tests: dividend/split multiplier updates must not break raw math (`cargo test test_token2022`)

## Backend (prototype; incomplete)

```
backend/src/
  indexer/  listener.ts, holdingsSync.ts
  workers/  navEngine.ts, priceFetch.ts, feeCrank.ts
  api/      routes/baskets.ts, quotes.ts
```

The intended indexer listens to `BasketCreated/Minted/Redeemed/FeeAccrued`, syncs `vault_holdings` raw+scaled, computes `NAV = Σ(scaled*price)`, and snapshots every 60s. Current server wiring still has empty/mock basket data and must pass the backend build before this is claimed live.

## Frontend (prototype; bklit migration pending)

```
app/
  page.tsx (landing) / explore / basket/[pubkey] / create (6-step wizard) / portfolio / legal
```

The visual wizard includes validation concepts, but wallet signing and `create_basket` execution are not complete. The current chart tree is local and uses `@visx`; Bklit registry provenance must be verified before claiming full Bklit compliance.

## Security

See spec §11. Key invariants:

- `redeem_in_kind` never gated by oracle/pauser/backend
- No `admin_withdraw`
- Fuzz properties: deposits→full redeem pro-rata, no over-redeem, management fee cap, multiplier invariance

Run `cargo test` + `cso` + `review-and-iterate` before `deploy-to-mainnet`.

## Legal Placeholders `LEGAL_REVIEW_REQUIRED`

Every basket shows: not investment advice, jurisdiction restrictions, xStocks are structured instruments, creators not licensed advisers. See spec §12.

## Milestones

The detailed execution plan is in `plan.md`. Current: **discovery complete; G0/G1 decision gates pending; implementation not started in this coordination wave**.

## Scripts

- `scripts/e2e.sh` — intended deterministic localnet flow; referenced helper scripts are currently missing, so do not treat this as runnable E2E.

---

Generated from `foliox_build_prompt.md` via solana.new superstack skills (`scaffold-project`, `build-defi-protocol`, `cso`).
