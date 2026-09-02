# FolioX — xStocks Strategy Baskets on Solana

> "Create an index. Own your thesis." — Onchain strategy baskets powered by xStocks.
> V0 spec: `docs/foliox-v0-spec.md` (normative product constraints). Execution plan: `plan.md`. Brand: `brand.md`.
> Current state: **V0 implementation waves complete** — protocol, backend, and frontend are real and gated (see `plan.md` §6 release gates, all evidenced PASS). Localnet E2E attempt in flight (SBF toolchain blocker tracked there). Not yet devnet/mainnet — `LEGAL_REVIEW_REQUIRED` placeholders still need counsel.

## Tests (all green)

```bash
cargo test                                  # 178 Rust tests
npm --prefix backend install                # once (backend has its own lockfile)
npm --prefix backend run build              # strict NodeNext, no suppressions
npm --prefix backend test -- --run          # 373 TS tests
(cd app && npx tsc --noEmit --incremental false)   # 0 errors
npm --prefix app run build                  # 13 routes, no ignored errors
```

## Stack

- **Solana programs (Anchor 0.30, real Token-2022 CPI):** `whitelist` (Token-2022 ownership + decimals verification), `basket_factory` (atomic seed transfers, genesis 1M with temp-mint-authority handoff), `basket` (real `transfer_checked`/`burn`/`mint_to`; `redeem_in_kind` permissionless + oracle-free, structurally tested)
- **Backend:** Node 20 + TypeScript (strict) + PostgreSQL + optional Redis — real indexer (Anchor event decode), holdings sync with ScaledUiAmount multiplier, exact BigInt fixed-point NAV engine, REST API with `source`/`asOf` provenance on every row; backend never signs
- **Frontend:** Next.js 15 + Tailwind 3.4 + **bklit UI** (registry provenance verified — see `docs/bklit-registry-findings-2026-09-01.md`; Brush = documented local adapter) + wallet-adapter (Phantom/Solflare, full state machine) — brand per `brand.md` (Mineral Desk, Geist/Geist Mono)
- **Token:** SPL Token-2022 — raw transfers on-chain, `scaled = raw × multiplier` for display/NAV

## Programs

| Program | ID (localnet/devnet) | State |
|---------|----------------------|-------|
| `whitelist` | `bdEDPr9KGtkSABS8Sg3gWeJKyQEaTQVaBRvCu38YMNz` | Real; `add_mint` verifies Token-2022 ownership + decimals (extension-aware) |
| `basket_factory` | `sXShikYX7G5n3S3qp78RWQBxh2YJARLvufiCoaxjAyq` | Real; full §3.2 validations, atomic seed, genesis mint, real `vault_bump` |
| `basket` | `37VPGtd57kXJ1HvH1xvdZr1y3s4KXj9pP2o6GdYLgbb1` | Real; `mint_in_kind` (4n remaining-accounts contract, pause-gated), `redeem_in_kind` (3n, never gated), `accrue_management_fee` |

See `docs/foliox-v0-spec.md` §2-6 for account model, instruction args, mint/redeem math, fee math. Client instruction builders live in `app/lib/transactions.ts` + `app/lib/create-basket.ts` (mirrored from program source, discriminators cross-verified).

## Token-2022 Accounting

- On-chain: **raw** (`transfer_checked` with decimals; `// RAW ONLY` on every CPI site)
- Off-chain: `scaled = raw × multiplier` (`ScaledUiAmountConfig`, f64 per spl-token 0.4.15); amounts crossing module boundaries travel as decimal strings (BigInt-exact)

## Backend (real)

Indexer listens for `BasketCreated/Minted/Redeemed/FeeAccrued` (Borsh decoders), upserts `baskets`/`events`/`creator_stats`, syncs `vault_holdings` (raw + multiplier + scaled), NAV engine snapshots `nav_snapshots` + refreshes `basket_rankings`, fee crank emits **unsigned** `accrue_management_fee` transactions. REST `/api/v1` implements the spec §8-9 routes with honest empty/error states (`NOT_INDEXED`, `DB_UNAVAILABLE`, `QUOTE_UNAVAILABLE`) — no fabricated production-looking data. Zap quotes proxy Jupiter; provenance + sequential/non-atomic warning included.

## Frontend (real — 13 routes)

Landing, Explore (comparison-first table), Market + Stock (normalized multi-series AreaChart + OHLC Candlestick + volume + Brush), Providers (honest status), basket Detail (NAV chart, drift table, fees, action rail), Buy (In-Kind with exact 1%-tolerance validation + Zap with provenance), Redeem (pro-rata floor preview, oracle-free copy), Create (6-step wizard with hard validation gates + account-level review modal), Portfolio, Creator, Legal. Wallet: Phantom/Solflare with disconnected/connecting/connected/wrong-network/rejected states. Shared: skeleton/error/empty/`FreshnessBadge` library, `@/lib/format` (raw↔scaled BigInt-exact).

## Security

See spec §11. Key invariants (all evidenced in `plan.md` §6 gate table): `redeem_in_kind` never gated (no whitelist/oracle/pauser account in its context; structural test), no `admin_withdraw`, RAW-only transfers, fee caps + 90/10 split, genesis 1M inflation-attack protection. Run `cargo test` + `cso` + `review-and-iterate` before devnet/mainnet.

## Legal Placeholders `LEGAL_REVIEW_REQUIRED`

11 files carry visible placeholders (landing, basket, redeem, providers, stock, legal, footer, deploy-panel, fees-editor, legal-checkboxes, legal-review-tag). Never describe FolioX as an ETF/fund; voice rules in `brand.md`. Counsel review required before mainnet.

## Milestones

Execution state in `plan.md` §7-8. G0 (brand: Mineral Desk + Geist) and G1 (Bklit provenance) resolved; protocol/backend truth waves complete; Wave C pages complete; Wave D static QA complete. In flight: localnet E2E (`scripts/e2e.sh` + SBF toolchain attempt — `anchor build` SBF is blocked by edition2024 platform-tools; see AGENTS.md §20).

## Scripts

- `scripts/e2e.sh` — deterministic localnet flow (validator → whitelist → basket → mint/redeem → fee crank); landing now, runnable once the SBF toolchain attempt concludes (status in `plan.md` §8)

---

Generated from `foliox_build_prompt.md` via solana.new superstack skills (`scaffold-project`, `build-defi-protocol`, `cso`, `brand-design`) + orchestrated implementation waves (2026-09-01).
