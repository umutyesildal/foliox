# Basalt App (Next.js 15)

Current status: **fully implemented frontend** — 13 routes, wallet-wired, brand-applied (Mineral Desk + Geist/Geist Mono per [`../brand.md`](../brand.md)). Gates: `npx tsc --noEmit --incremental false` = 0 errors; `npm run build` = green with no ignored errors (`next.config.js` is empty — no `ignoreBuildErrors`). See the repository-level [implementation plan](../plan.md) and [UI discovery](../docs/ui-discovery-2026-09-01.md).

## Pages (spec §9 — all real)

- `app/page.tsx` — Landing (asymmetric hero, one CTA, featured basket only from real data)
- `app/explore/` — comparison-first ranking table + mobile cards, search/sort, loading/error/empty
- `app/basket/[pubkey]/` — detail: NAV chart, drift table (target/actual), fees + 90/10, oracle-free redeem explainer, action rail
- `app/basket/[pubkey]/buy/` — In-Kind (exact BigInt 1%-tolerance weight validation, limiting-leg named) | Zap USDC (Jupiter legs + provenance + non-atomic warning); full simulate → review → sign state machine
- `app/basket/[pubkey]/redeem/` — pro-rata floor preview (raw + scaled + labeled USD estimate), irreversible/oracle-free copy, quiet accrue crank
- `app/create/` — 6-step wizard: 2–20 Active mints → exact 10,000 bps → fee caps 300/100/300 → seed preview → 4 legal checkboxes (`LEGAL_REVIEW_REQUIRED`) → account-level deploy review modal
- `app/creator/[pubkey]/`, `app/portfolio/`, `app/legal/` — honest empty/wallet-gated states, no fabricated numbers
- `app/market/`, `app/stock/[ticker]/`, `app/providers/` — bklit chart workspaces (3/4-series normalize-100, OHLC candlestick, volume, Brush zoom, source/as-of labels)

## Foundation (consume, don't rebuild)

- `lib/transactions.ts` + `lib/create-basket.ts` — client-side Anchor instruction builders (no IDL), mirrored from program source; discriminators + account orders cross-verified (incl. the 4n `mint_in_kind` remaining-accounts contract)
- `lib/format.ts` — BigInt-exact raw↔scaled, token/USD/bps formatting, address truncation
- `lib/wallet.ts` + `app/providers.tsx` — wallet state machine (disconnected/connecting/connected/wrong-network/rejected) + `useWalletFeedback()`
- `components/shell/` — responsive header/footer, wallet button, network indicator
- `components/states/` — Skeleton variants, `ErrorState`, `EmptyState`, `FreshnessBadge({source, asOf, demo})`

## Charts

`components/charts/*` are verified official Bklit registry source (see [`../docs/bklit-registry-findings-2026-09-01.md`](../docs/bklit-registry-findings-2026-09-01.md)). `chart-brush.tsx` is a **documented local adapter** (official Brush has no distributable source — 404); never label it official. `@bklit/legend` is installed but not yet wired (pending a `--legend` token decision in `globals.css`).

## Known gaps

- Transaction flows are simulation-tested in code but not yet run against a live localnet validator (SBF toolchain blocker — tracked in `plan.md`).
- Baskets with ≥5 constituents need Address Lookup Tables (serialized v0 tx exceeds the 1232-byte packet limit) — V1 item, surfaced as an explicit caution in the wizard.
- Legend wiring, ESLint config for `app/`, and the browser-level QA pass are pending final integration.
