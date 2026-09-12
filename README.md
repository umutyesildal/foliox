# FolioX — xStocks Strategy Baskets on Solana

> "Create an index. Own your thesis." — Onchain strategy baskets powered by xStocks.
> V0 spec: `docs/foliox-v0-spec.md` (normative product constraints). Execution plan: `plan.md`. Brand: `brand.md`.
> Current state: **LIVE ON DEVNET (2026-09-04) — 3 programs deployed at declared IDs, 12 mock xStocks whitelisted, one basket live with mint/redeem/fee verified on-chain (38 confirmed txs; redeem_in_kind proven permissionless under a paused constituent). Backend indexer/NAV/fee-crank live against devnet. 599 tests (178 Rust + 442 backend TS).** Not yet mainnet. Evidence: `docs/devnet-live-2026-09-04.md`.

## Tests (all green)

```bash
cargo test                                  # 178 Rust tests
npm --prefix backend install                # once (backend has its own lockfile)
npm --prefix backend run build              # strict NodeNext, no suppressions
npm --prefix backend test -- --run          # 421 TS tests
(cd app && npx tsc --noEmit --incremental false)   # 0 errors
npm --prefix app run build                  # 13 routes, no ignored errors
```

## Devnet live (2026-09-04)

- Deployed at declared IDs: `whitelist` `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS`, `basket_factory` `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF`, `basket` `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k`.
- 12 mock xStocks whitelisted (TSLAx…SPYx, Token-2022 ScaledUiAmountConfig); one live basket at 3 constituents — NVDAx/AAPLx/MSFTx 4000/3200/2800 bps, fees 100/50/200 — with mint, redeem, and management-fee flows confirmed on-chain (38 txs, all `err: null`; supply/fee/NAV reconcile exactly).
- Known limit: `create_basket` at 4+ constituents exceeds the legacy 1232 B transaction wire limit — fix path is versioned (v0) txs + address lookup tables.

Run the backend against devnet:

```bash
cd backend && set -a && . ./.env.devnet && set +a && npx tsx src/index.ts
```

Full evidence pack — signature tables, address tables, reconciliation, reproduction steps: `docs/devnet-live-2026-09-04.md`.

## Stack

- **Solana programs (Anchor 0.30, real Token-2022 CPI):** `whitelist` (Token-2022 ownership + decimals verification), `basket_factory` (atomic seed transfers, genesis 1M with temp-mint-authority handoff), `basket` (real `transfer_checked`/`burn`/`mint_to`; `redeem_in_kind` permissionless + oracle-free, structurally tested)
- **Backend:** Node 20 + TypeScript (strict) + PostgreSQL + optional Redis — real indexer (Anchor event decode), holdings sync with ScaledUiAmount multiplier, exact BigInt fixed-point NAV engine, REST API with `source`/`asOf` provenance on every row; backend never signs
- **Frontend:** Next.js 15 + Tailwind 3.4 + **bklit UI** (registry provenance verified; Brush = documented local adapter) + wallet-adapter (Phantom/Solflare, full state machine) — brand per `brand.md` (monochrome base + Roman layer, Cinzel display)
- **Token:** SPL Token-2022 — raw transfers on-chain, `scaled = raw × multiplier` for display/NAV

## Programs

| Program | ID (localnet/devnet) | State |
|---------|----------------------|-------|
| `whitelist` | `FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS` | Real; `add_mint` verifies Token-2022 ownership + decimals (extension-aware) |
| `basket_factory` | `3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF` | Real; full §3.2 validations, atomic seed, genesis mint, real `vault_bump` |
| `basket` | `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k` | Real; `mint_in_kind` (4n remaining-accounts contract, pause-gated), `redeem_in_kind` (3n, never gated), `accrue_management_fee` |

See `docs/foliox-v0-spec.md` §2-6 for account model, instruction args, mint/redeem math, fee math. Client instruction builders live in `app/lib/transactions.ts` + `app/lib/create-basket.ts` (mirrored from program source, discriminators cross-verified).

## Token-2022 Accounting

- On-chain: **raw** (`transfer_checked` with decimals; `// RAW ONLY` on every CPI site)
- Off-chain: `scaled = raw × multiplier` (`ScaledUiAmountConfig`, f64 per spl-token 0.4.15); amounts crossing module boundaries travel as decimal strings (BigInt-exact)

## Backend (real)

Indexer listens for `BasketCreated/Minted/Redeemed/FeeAccrued` (Borsh decoders), upserts `baskets`/`events`/`creator_stats`, syncs `vault_holdings` (raw + multiplier + scaled), NAV engine snapshots `nav_snapshots` + refreshes `basket_rankings`, fee crank emits **unsigned** `accrue_management_fee` transactions. REST `/api/v1` implements the spec §8-9 routes with honest empty/error states (`NOT_INDEXED`, `DB_UNAVAILABLE`, `QUOTE_UNAVAILABLE`) — no fabricated production-looking data. Zap quotes proxy Jupiter; provenance + sequential/non-atomic warning included.

## Frontend (real — 12 routes, new IA)

Owner-approved information architecture (2026-09-03):

- `/` Home — NEON FOUNDRY hero + **live proof band** (friendly sentence-style preview of the latest verified trades + top baskets, polled live from the social API) + **CREATE · MINT · SHARE** three-step flow + **SAME EXPOSURE** traditional-vs-tokenized ledger comparison at the full 6xl rhythm + intent cards (Browse baskets / Follow top traders / Open the feed / Build your own)
- `/stocks` — provider-grouped grid of tokenized stocks (live price, 24h, sparkline) → `/stock/[ticker]` detail (one clean chart, ethereal series colors, fitY-domain)
- `/etfs` — pure tokenized-ETF listing (grid, sort, clickable cards)
- `/explore` — **Baskets** flagship: grid-only cards (name-first — "Tech Duo", composition + price + 24h + vs-SPY), whole card clickable
- `/create` — 6-step wizard (wallet-gated Next, working slim sliders, over-10k allowed with exact-10k deploy gate, plain-language seed step with live value preview)
- `/basket/[pubkey]` + buy/redeem — transaction surfaces; `/portfolio`, `/creator/[pubkey]`, `/legal`

Design language: **monochrome UI chrome** (classic shadcn dark/light) + **ethereal chart data palette** (sage/rose/blue/sand/lavender, benchmark gray dashed — user decision 2026-09-03). No site footer; LEGAL_REVIEW_REQUIRED chips removed from the UI (review backlog — the wizard's legal-checkbox step stays functional). Charts are verified-official Bklit components (Brush = documented local adapter).

## Social trading (V0.2 — fomo.family-inspired, not a clone)

Every basket trade already settles on-chain, so the feed shows **verified activity, not claims**: the indexer's per-wallet `events` ledger (Minted/Redeemed) now backs `/feed` (All / Following / Theses tabs), per-wallet trade history, and an estimated-ROI leaderboard (7d/30d/All; anti-sybil eligibility — ≥2 mints, first trade ≥7 days old, live value > 0, public profile). On top of the "what":

- **Thesis posts** — trade-linked reasoning attached to a basket; the on-chain outcome stays attached for free
- **Social profiles** — optional handle/avatar/bio over a wallet pubkey (`profiles`), follow/unfollow, per-wallet equity curve (`user_value_snapshots`, ~5m snapshotter)
- **Privacy** — trades are public by default (the chain is public anyway); `is_public=false` hides a wallet from feed + leaderboard
- **Auth** — wallet-signature only (SIWS-lite: `POST /auth/nonce` → sign → `/auth/verify` → bearer token); it gates **social writes only** — the backend remains read-only/non-custodial for everything else and still never signs transactions
- **No auto-copy** (deliberate) — copying is "Clone this basket" into the create wizard (regulatory + latency reasons); feed refreshes by 30s polling

## Security

See spec §11. Key invariants (all evidenced in `plan.md` §6 gate table): `redeem_in_kind` never gated (no whitelist/oracle/pauser account in its context; structural test), no `admin_withdraw`, RAW-only transfers, fee caps + 90/10 split, genesis 1M inflation-attack protection. Run `cargo test` + `cso` + `review-and-iterate` before devnet/mainnet.

## Legal Placeholders

UI chips were removed at the owner's request (2026-09-03); the review items live in the backlog and the wizard's legal-checkbox step + `/legal` page remain. Never describe FolioX as an ETF/fund; voice rules in `brand.md`. Counsel review required before mainnet.

## Local dev demo data

For local (non-devnet) development, `demo-seed` seeds the local Postgres so pages render with content: 4 whitelisted mock xStocks (TSLAx/AAPLx/NVDAx/SPYx from `docs/providers.md`) and two demo baskets (**Tech Duo** 50/50 AAPLx-TSLAx, **Index Plus** 60/25/15 SPYx-NVDAx-AAPLx) with 30d NAV history (`demo-seed` source marker). Dev-only — drop or re-seed freely. When the backend runs against devnet instead, pages serve on-chain-indexed data (see "Devnet live" above) and the seed is unnecessary.

## Milestones

Execution state in `plan.md` §7-8. G0 brand superseded by the owner's **monochrome** decision (2026-09-03); G1 Bklit provenance resolved; protocol/backend truth waves complete; new-IA UI waves complete (owner feedback rounds 1-2 applied). **DEVNET LIVE (2026-09-04)** — evidence in `docs/devnet-live-2026-09-04.md`, status snapshot in `plan.md` §8c; next: versioned (v0) txs + ALTs for >3 constituents, owner review / merge of `roman-empire`.

## Scripts

- `scripts/e2e.sh` — deterministic localnet flow (validator → whitelist → basket → mint/redeem → fee crank)
- Devnet E2E — the same four scripts (`scripts/createWhitelist.ts` → `createBasket.ts` → `mintAndRedeem.ts` → `accrueFee.ts`) run against devnet via `FOLIOX_E2E_*` env vars; state + logs + evidence collector in `scripts/.e2e-devnet/` (reproduction commands in `docs/devnet-live-2026-09-04.md` §8)

---

Generated from `foliox_build_prompt.md` via solana.new superstack skills (`scaffold-project`, `build-defi-protocol`, `cso`, `brand-design`) + orchestrated implementation waves (2026-09-01).
