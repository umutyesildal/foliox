# FolioX — xStocks Strategy Baskets on Solana

> "Create an index. Own your thesis." — Onchain strategy baskets powered by xStocks.
> V0 spec: `docs/foliox-v0-spec.md` (normative product constraints). Execution plan: `plan.md`. Brand: `brand.md`.
> Current state: **V0 implemented — protocol (real Token-2022 CPI, localnet E2E 8/8 PASS), backend (real indexer/NAV/API), frontend (new IA, Roman identity UI on `roman-empire` branch). 178 Rust + 392 backend TS tests.** DEVNET PAUSED ON FAUCET FUNDING (staged rerun in `plan.md` §8b) — not yet devnet/mainnet.

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

- `/` Home — classic shadcn hero + framed product visual + **Traditional vs tokenized** interactive comparison + gateway to the three sections
- `/stocks` — provider-grouped grid of tokenized stocks (live price, 24h, sparkline) → `/stock/[ticker]` detail (one clean chart, ethereal series colors, fitY-domain)
- `/etfs` — pure tokenized-ETF listing (grid, sort, clickable cards)
- `/explore` — **Baskets** flagship: grid-only cards (name-first — "Tech Duo", composition + price + 24h + vs-SPY), whole card clickable
- `/create` — 6-step wizard (wallet-gated Next, working slim sliders, over-10k allowed with exact-10k deploy gate, plain-language seed step with live value preview)
- `/basket/[pubkey]` + buy/redeem — transaction surfaces; `/portfolio`, `/creator/[pubkey]`, `/legal`

Design language: **monochrome UI chrome** (classic shadcn dark/light) + **ethereal chart data palette** (sage/rose/blue/sand/lavender, benchmark gray dashed — user decision 2026-09-03). No site footer; LEGAL_REVIEW_REQUIRED chips removed from the UI (review backlog — the wizard's legal-checkbox step stays functional). Charts are verified-official Bklit components (Brush = documented local adapter; see `docs/bklit-registry-findings-2026-09-01.md`).

## Security

See spec §11. Key invariants (all evidenced in `plan.md` §6 gate table): `redeem_in_kind` never gated (no whitelist/oracle/pauser account in its context; structural test), no `admin_withdraw`, RAW-only transfers, fee caps + 90/10 split, genesis 1M inflation-attack protection. Run `cargo test` + `cso` + `review-and-iterate` before devnet/mainnet.

## Legal Placeholders

UI chips were removed at the owner's request (2026-09-03); the review items live in the backlog and the wizard's legal-checkbox step + `/legal` page remain. Never describe FolioX as an ETF/fund; voice rules in `brand.md`. Counsel review required before mainnet.

## Local dev demo data

The UI phase seeds the local Postgres so pages render with content: 4 whitelisted mock xStocks (TSLAx/AAPLx/NVDAx/SPYx from `docs/providers.md`) and two demo baskets (**Tech Duo** 50/50 AAPLx-TSLAx, **Index Plus** 60/25/15 SPYx-NVDAx-AAPLx) with 30d NAV history (`demo-seed` source marker). Dev-only — drop or re-seed freely.

## Milestones

Execution state in `plan.md` §7-8. G0 brand superseded by the owner's **monochrome** decision (2026-09-03); G1 Bklit provenance resolved; protocol/backend truth waves complete; new-IA UI waves complete (owner feedback rounds 1-2 applied). **Paused (WIP commit `e961849`)**: localnet E2E + create_basket stack-overflow refactor — SBF pins and `idl-build` features are already in place; resume on owner request.

## Scripts

- `scripts/e2e.sh` — deterministic localnet flow (validator → whitelist → basket → mint/redeem → fee crank); landing now, runnable once the SBF toolchain attempt concludes (status in `plan.md` §8)

---

Generated from `foliox_build_prompt.md` via solana.new superstack skills (`scaffold-project`, `build-defi-protocol`, `cso`, `brand-design`) + orchestrated implementation waves (2026-09-01).
