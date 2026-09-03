# FolioX Implementation Plan

> Owner: coordinator (Codex) | Workspace: `createyouretf` | Last reviewed: 2026-09-01
> Current phase: documented discovery complete; implementation is gated on the decisions in G0.
> Normative product constraints remain in `docs/foliox-v0-spec.md` and `AGENTS.md`.

## 0. Purpose and source of truth

This is the execution plan for taking FolioX from a scaffold/prototype to a truthful, testable, polished Solana strategy-basket application. It covers protocol correctness, backend data, wallet flows, bklit UI, legal copy, accessibility, responsive behavior, and Orca worker coordination.

Use the documents in this order:

1. `AGENTS.md` — hard constraints and agent workflow.
2. `docs/foliox-v0-spec.md` — product, account, math, API, security, legal, and milestone specification.
3. `docs/ui-discovery-2026-09-01.md` — verified current-state audit and design direction.
4. `plan.md` — ordered implementation work, dependencies, acceptance gates, and decision log.
5. `README.md` and `app/README.md` — operator-facing quick start and status only.

`foliox_build_prompt.md` remains the original product prompt. Do not silently weaken a constraint in the prompt or spec to make a demo easier.

## 1. Product guardrails

FolioX is an onchain strategy-basket application backed by Token-2022 xStocks. It is not described as a registered ETF, fund, guaranteed return, safe investment, or financial advice. `LEGAL_REVIEW_REQUIRED` remains visible anywhere legal or risk language appears until counsel replaces the placeholders.

The following are non-negotiable in every phase:

- Baskets are immutable after deployment: constituents, weights, creator, metadata hash, and fee schedule do not change.
- `redeem_in_kind` is permissionless, oracle-free, and never gated by whitelist pause, backend availability, or an oracle.
- There is no leverage, lending, derivatives, rebasing, active rebalancing, or pooled off-chain custody.
- Backend/indexer services never hold signing keys or custody user assets.
- On-chain transfers use raw Token-2022 amounts and checked decimals. Scaled UI Amount multipliers are used only for display/NAV accounting off-chain.
- Jupiter is periphery in V0. In-kind mint/redeem remains the core path; sequential zap atomicity and slippage limitations are disclosed.
- Fees remain capped at entry 300 bps, exit 100 bps, and management 300 bps/year, with the documented 90/10 creator/treasury split.

## 2. Verified baseline

The new Orca discovery run is `run_b38cb1bbcd0c`. Three fresh, read-only workers completed successfully:

- UI audit: landing, explore, basket detail, create, providers, and stock have local Card/Badge/Table and local chart APIs; buy, redeem, portfolio, and legal remain scaffolds. Creator and explore loading routes are missing. Accessibility, responsive navigation, truthful data states, and native controls need work.
- Design audit: use a dark-native quiet research terminal direction — Workstation Dense information architecture with Warm Monochrome restraint. Remove decorative neon, gradients, faux browser chrome, marquee tickers, blanket pills, duplicate desktop card/table views, and unsupported performance language.
- Readiness audit: all project files are currently untracked in Git, so prior worker changes cannot be isolated by commit. The app build passes only because Next ignores build/type errors; strict app TypeScript fails. Backend build fails NodeNext/implicit-any errors. Backend tests pass 286; the root legacy test adds 1, for 287 TypeScript tests total.

The current baseline is not localnet-ready or production-ready even though older notes say so. Protocol instructions still contain stubbed transfer/mint/burn behavior, the backend still has empty/mock basket data, wallet wiring is absent, and the E2E helper scripts referenced by documentation are missing.

## 3. Decision gates before implementation

### G0 — brand and telemetry — RESOLVED 2026-09-01

Resolved by user decision: run `brand-design` (full interview + previews), telemetry **off**. Outcome applied to the repo:

- Palette **Mineral Desk** (warm near-black canvas, mineral-mint primary `#66ccba`, sage/clay/ochre semantic statuses) — picked from 6 AA-verified candidates; user pick recorded.
- Typography **Geist + Geist Mono** via `next/font/google` — user pick recorded.
- No brand gradients (audit anti-slop rule stands).
- `brand.md` written at repo root; `app/app/globals.css` tokens applied (backup `app/app/globals.css.bak`); `app/app/layout.tsx` + `app/tailwind.config.js` wired.
- Telemetry config set to off (`~/.superstack/config.json`); no telemetry events are written.

### G1 — registry provenance — RESOLVED 2026-09-01

Verified live against the official registry (every `/r/{name}.json` endpoint status-checked, 14 payloads byte-diffed against local sources). Full evidence in `docs/bklit-registry-findings-2026-09-01.md`. Findings:

1. Local `app/components/charts/*` ARE official Bklit source — official charts are themselves `@visx`-backed (`@visx/*@4.0.1-alpha.0` + `motion`, matching `app/package.json`). candlestick-chart, grid, x-axis, chart-animation byte-identical; area/line/bar/tooltip near-identical with tiny local edits.
2. **Brush is the true gap:** `/r/brush.json` and `/r/chart-brush.json` are 404 and no payload ships ChartBrush source, although docs document the API. The local `chart-brush.tsx` stays as a **justified, documented local adapter** — never labeled official.
3. Naming corrections: official items are `@bklit/candlestick-chart` and `@bklit/chart-tooltip` (AGENTS.md's `candlestick`/`tooltip` names 404). Official `@bklit/legend` exists but is not installed locally — install `npx shadcn@latest add @bklit/legend` in a Wave C worker.
4. Root `recharts@^3.10.1` has zero imports repo-wide and no Bklit component depends on it — removed by the coordinator (Phase 3 task 5 closed).

The frozen chart contract: AreaChart/LineChart/BarChart/Candlestick/Grid/Tooltip/Animation = official Bklit (local copies verified); Brush = documented local adapter pending official distribution; Legend = official, to be installed.

### G2 — protocol/API truthfulness

Decide whether the first public milestone is:

- a clearly labeled read-only/demo UI with no signing claims, or
- a localnet end-to-end milestone with real Token-2022 accounts, wallet signing, and protocol instructions.

The preferred path is localnet correctness before showing actionable mint/redeem controls. A demo may use fixture data only when it is visibly labeled as demo/as-of data and cannot be mistaken for live NAV or executable funds movement.

## 4. Ordered implementation phases

### Phase 0 — documentation and repository baseline

Dependencies: G0 is recorded; no code implementation yet.

Tasks:

1. Keep `plan.md`, `docs/ui-discovery-2026-09-01.md`, `AGENTS.md`, `CLAUDE.md`, and `CONTEXT.md` synchronized on status and constraints.
2. Create a safe baseline commit or equivalent immutable snapshot before new code edits. Do not reset, clean, or delete the existing untracked work.
3. Replace stale placeholder IDs and “scaffold pending” claims in operator documentation.
4. Record exact commands, versions, pass counts, and known failures in the phase log.

Exit gate: a new agent can identify the current truth in under five minutes, and no documentation says that the current protocol is localnet-ready.

### Phase 1 — protocol correctness foundation

Dependencies: Phase 0.

Tasks:

1. Whitelist: verify the supplied mint is owned by Token-2022 and the configured decimals match the mint account; preserve active/paused-new-mints semantics.
2. Factory: implement canonical basket/share-mint/vault PDA initialization, canonical Token-2022 accounts, atomic creator seed transfers, and fixed genesis share minting.
3. Basket: implement real Token-2022 transfers, checked decimals, share mint/burn, canonical PDA constraints, expected mint/owner/ATA checks, and fee distribution.
4. Keep `redeem_in_kind` free of whitelist/oracle/backend/pauser accounts and add negative tests proving pause does not block redeem.
5. Preserve all raw/scaled accounting and use `u128` intermediates with floor semantics for on-chain math.

Exit gate: localnet create → seed → mint → redeem → management-fee flow works with real accounts; security checklist P0/P1 is evidence-backed; Rust tests remain green.

### Phase 2 — backend truth and API foundation

Dependencies: Phase 1 account/event shape; can begin schema/type work in parallel after Phase 0.

Tasks:

1. Fix NodeNext imports and strict typing so `npm --prefix backend run build` passes without suppressions.
2. Connect Postgres schema, event decoding, basket discovery, whitelist reads, holdings sync, multiplier reads, and NAV snapshots.
3. Use integer-safe/raw values for token accounting; avoid JavaScript `Number` for amounts that can exceed safe integer range.
4. Make empty/loading/stale/error states explicit in API responses. Keep fallback prices and fixtures behind an explicit `demo`/`source` marker.
5. Implement the documented basket, holdings, NAV history, performance, creator, portfolio, whitelist, and zap quote endpoints. Backend never signs.

Exit gate: a fresh localnet basket appears through the API, source/as-of metadata is present, no endpoint silently returns fabricated production-looking data, and backend build/tests pass.

### Phase 3 — frontend foundation and Bklit migration

Dependencies: G0 and G1; Phase 2 API contracts for live states.

Tasks:

1. Establish semantic design tokens in `app/globals.css` and the chosen brand documentation. Remove hardcoded `zinc`/`white`/decorative gradients from product surfaces.
2. Build a responsive shell: FolioX mark, Explore/Market/Providers navigation, contextual Create/Portfolio actions, network state, freshness state, wallet connection, active route, breadcrumbs, and legal footer.
3. Resolve strict Next 15/React 19 typing: Promise route params, component prop mismatches, `asChild` misuse, Slider unions, chart props, React DOM types, and ES2015+ target requirements.
4. Verify Bklit registry provenance for AreaChart, LineChart, BarChart, Candlestick, Grid, Tooltip, Legend, and Brush. Replace local placeholder adapters or document a justified compatibility wrapper.
5. Remove the root `recharts` dependency and keep chart primitives scoped to the Bklit contract. Use bklit chart APIs for all requested charts.
6. Add shared states: skeletons matching content shape, retryable errors, useful empty states, disabled/loading/pressed/focus states, reduced-motion behavior, and accessible chart summaries.

Exit gate: `npx tsc --noEmit --incremental false` and `npm --prefix app run build` pass without ignored errors; no `@ts-nocheck` remains in product pages; keyboard and mobile smoke checks pass.

### Phase 4 — core user flows

Dependencies: Phases 1–3.

Tasks:

1. Wallet provider: disconnected, connecting, connected, wrong network, and rejected-signature states.
2. Create wizard: select 2–20 active xStocks, weight sum exactly 10,000 bps, fee caps, seed preview, immutable metadata hash, legal checkboxes, transaction review, and status timeline.
3. In-kind mint: raw amount inputs, target-weight validation, scaled display, entry fee/net shares, balance checks, simulation/review, sign, confirm, and recovery.
4. Zap-in: quote provenance, sequential swap legs, slippage inline warning, intermediate-token explanation, and explicit non-atomicity.
5. Redeem: share balance, pro-rata raw-floor outputs, scaled/multiplier display, optional USD estimate clearly marked as NAV/reference, exit fee, irreversible warning, and direct oracle-free transaction path.
6. Portfolio: wallet gate, real positions, raw/scaled/multiplier fields, cost basis, redeem action, and empty/error states.

Exit gate: no primary action is a dead button or a copy-only placeholder; every signing flow has simulation/review, connecting, pending, confirmed, failed, and user-rejected states.

### Phase 5 — page-by-page product polish

Dependencies: Phase 4 foundations; read-only pages may be parallelized by disjoint file ownership.

| Surface | Target composition | Acceptance criteria |
|---|---|---|
| Landing | Asymmetric hero, one clear CTA, sourced/as-of data, featured basket, quiet Create → Mint → Redeem explainer | No fake-live marquee, no faux browser chrome, no unsupported return promise |
| Explore | Search/filter/sort controls and one comparison-first ranking table; cards only as a deliberate mobile representation | AUM, share price, 24h, holders, drift, source/freshness, loading/empty/error |
| Basket detail | Identity/immutable parameters, metric strip, dominant NAV AreaChart, allocation/drift table, fees, risk/redeem explainer, action rail | Raw vs scaled disclosure, target/actual/drift clarity, no duplicated metric-card clutter |
| Buy | In-Kind/Zap tabs with form labels, fee quote, weight validity, route provenance, review/sign modal | Wallet-aware, sequential-swap warning inline, all transaction states |
| Redeem | Wallet/share input, per-constituent preview, raw floor, scaled multiplier, exit fee, oracle-free copy | Never asks for an oracle/whitelist/backend gate; permissionless path is clear |
| Create | Six-step stepper plus summary rail | Blocks invalid 2–20, 10,000 bps, fee caps, inactive mints, and unchecked legal step |
| Portfolio | Wallet gate and positions table | Honest no-wallet/no-position/error states; responsive table behavior |
| Providers | Source registry table, status/freshness/links, xStock issuer context | No fabricated provider health; badges are semantic, not decorative |
| Stock | Required 3-series normalized AreaChart + OHLC Candlestick + Volume BarChart + Brush | xStock/real/benchmark legend, source/as-of, accessible range control, no clipped charts |
| Market | Four-series normalized AreaChart + 30-candle volume/bar view + Brush | Muted consistent palette, benchmark dash, readable axes, responsive chart container |
| Creator | Creator identity, baskets, AUM, fee totals | Explicit placeholder only until API data exists |
| Legal | Reading-width disclosure document | `LEGAL_REVIEW_REQUIRED`, not-advice, jurisdiction, structured-instrument, custody, multiplier, slippage, and risk language |

### Phase 6 — quality, security, and release readiness

Dependencies: Phases 1–5.

Required checks:

```bash
cargo fmt --all -- --check
cargo check --workspace
cargo test --workspace
npm --prefix backend run build
npm --prefix backend test -- --run
(cd app && npx tsc --noEmit --incremental false)
npm --prefix app run build
git diff --check
```

Then run the localnet E2E only after the scripts and real instructions exist. Run security review, `cargo audit`, `npm audit`, and the relevant `cso`/`review-and-iterate` checks before any devnet/mainnet work.

Release must be blocked if any of these remain:

- protocol transfer/mint/burn behavior is still a stub;
- `redeem_in_kind` is gated or requires an oracle/backend/whitelist pause state;
- frontend build passes only because errors are ignored;
- `@ts-nocheck`, fake live data, dead transaction buttons, or unlabeled native controls remain;
- raw/scaled amounts are mixed, or JavaScript safe-integer limits can corrupt accounting;
- legal placeholders are removed without counsel approval;
- Bklit compliance is asserted without registry/source evidence.

## 5. Orca orchestration protocol

The coordinator owns the Run, decomposition, dependency gates, integration order, and final verification. Workers own bounded tasks and report exact files/tests; they do not silently broaden scope.

Use the current shared worktree only when file ownership is disjoint or a read-only audit is being performed. For implementation waves, prefer one foundation worker followed by parallel page workers with explicit file scopes. Never let two workers edit `globals.css`, shared chart primitives, shared wallet providers, or the same route simultaneously.

For every worker:

1. Create a Task under the active Run.
2. Start with `orca orchestration worker-start` and an explicit worktree/agent.
3. Require a concise `worker_done` containing outcome, files, commands, failures, and remaining risk.
4. Release settled workers; retain only when explicitly requested for debugging.
5. Acknowledge the delivery only after the completion or escalation has been processed.
6. Do not mutate the older UI run `run_7f4b8dbc5e4f`; it is historical context and has failed/ready work from an earlier wave.

Suggested waves after G0/G1:

- Wave A: foundation/type/build + registry provenance (single owner).
- Wave B: protocol/backend truth (parallel only where account/API scopes do not overlap).
- Wave C: shell and shared states, then page groups: research (Explore/Market/Stock/Providers), basket (detail/Buy/Redeem), onboarding (Create/Portfolio/Legal/Creator).
- Wave D: browser QA, accessibility, responsive, legal copy, and regression tests.

## 6. Documentation update protocol

After every phase or material decision:

- update the phase status and exact verification evidence in this file;
- update the dated discovery/decision log when the design or architecture changes;
- keep `AGENTS.md`, `CLAUDE.md`, and `CONTEXT.md` aligned with current reality;
- keep `docs/foliox-v0-spec.md` normative and append an erratum instead of silently rewriting a constraint;
- update README only for operator-facing commands/status, not as a second product specification.

## 7. Decision log

| Date | Decision | Owner | Status |
|---|---|---|---|
| 2026-09-01 | Create a fresh Orca supervised discovery Run with three read-only workers | coordinator | Done |
| 2026-09-01 | Use dark-native quiet research terminal direction as provisional design direction | coordinator/worker | Done (superseded by G0 below) |
| 2026-09-01 | Do not claim current app is localnet-ready; record protocol/backend/frontend gaps | coordinator | Done |
| 2026-09-01 | No frontend implementation before brand/telemetry decision and Bklit registry verification | coordinator | G0/G1 in progress |
| 2026-09-01 | G0 resolved by user: run `brand-design` now to create the deliberate brand; telemetry = off; brand.md is written before design tokens | user | Done — Mineral Desk + Geist applied, `brand.md` written |
| 2026-09-01 | G2 resolved by user: localnet end-to-end milestone first; no actionable mint/redeem UI before protocol truth | user | Decided — governs Wave B/C ordering |
| 2026-09-01 | Orchestration moved to ZCode coordinator with Agent subagents in waves (A foundation, B protocol/backend, C pages, D QA); disjoint file ownership enforced per wave; rolling concurrency ~2 workers due to account limit | user/coordinator | Active |
| 2026-09-02 | Brand superseded: UI monochrome (classic shadcn dark/light) + ethereal chart data palette; Mineral Desk retired; footer removed site-wide; LEGAL_REVIEW_REQUIRED chips removed from UI (review backlog — wizard legal step + /legal stay) | owner | Done |
| 2026-09-02/03 | New IA: Home (hero + product visual + Traditional-vs-Tokenized interactive + gateway) / Stocks (provider grid) / ETFs (pure clickable-card listing) / Baskets (grid-only, name-first, vs-SPY); Market+Providers unlinked from nav; two owner feedback rounds applied; baskets list API carries constituents/weights/metadata for card composition | owner | Done |
| 2026-09-03 | Localnet bring-up reached 6/8 E2E steps PASS (deploy + createWhitelist on-chain); create_basket hits SBF stack-frame overflow → refactor PAUSED at WIP `e961849` (owner: UI-only phase); SBF pins + idl-build features in place — resume on owner request | owner | Paused |
| 2026-09-03 | Devnet phase begins (owner request). T0 research verdict: NO official devnet tokens for xStocks/Ondo (verified on-chain; `docs/devnet-tokens-research-2026-09-03.md`) → devnet test uses self-minted Token-2022 mocks with ScaledUiAmountConfig. NOTE for mainnet: providers.md `Xs…` mints are REAL mainnet xStocks with **8 decimals, not 6** | coordinator | Done |

## 8b. Current status snapshot (2026-09-03)

- **Protocol: localnet E2E 8/8 PASS** (twice consecutive) — create_basket SBF stack-overflow fixed (try_accounts 4232 → 0 warnings; handler-side `#[inline(never)]` init helpers, factory authority signer-meta fix, 500k CU on client txs). 178 Rust + 392 backend TS tests green.
- **DEVNET — BLOCKED ON FUNDING (paused by owner 2026-09-03, resume anytime):** faucet 429 hard-limited (CLI 11 attempts + browser form + owner GitHub login attempt — all 0 SOL). Everything is staged for an instant rerun: devnet state dir `scripts/.e2e-devnet/` (treasury AAb2TX…, user2 48CUGM…), scripts env-parameterized (`FOLIOX_E2E_RPC_URL/PAYER/STATE_DIR/TREASURY`), deploy keypairs verified. **To resume:** send ≥11 SOL (ideal ~12) devnet SOL to `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE` (Phantom), then: deploy the 3 programs (`solana program deploy target/deploy/<name>.so --program-id target/deploy/<name>-keypair.json --url devnet`), `solana transfer 48CUGMWkw49EDkVQBq5TEb3M43oej9bJf7z8aF3zA3bg 1.5 --url devnet`, then run the four scripts with the env block above. Explorer links staged for whitelist `FRavMcY…` / factory `3hzoPep…` / basket `6Q43vFh…`.
- UI: new IA live (12 routes), two owner feedback rounds + restyles applied (detail, buy/redeem, providers). Monochrome chrome + ethereal chart palette; `brand.md` rewritten accordingly. Positions indexer landed (user_positions writer, 392 tests).
- Local dev demo data: 4 mock xStocks + Tech Duo / Index Plus baskets (`demo-seed`).
- Owner redirected work to UI improvements while devnet funding is pending.

## 8. Immediate next actions

Status as of 2026-09-01 (user decisions recorded in §7):

1. ~~User chooses brand/telemetry~~ — Done: `brand-design` run, **Mineral Desk** palette + **Geist/Geist Mono** applied (`brand.md`, `app/app/globals.css`, layout/tailwind wired), telemetry **off** (G0 closed).
2. ~~G2 choice~~ — Done: **localnet E2E first**; Wave B protocol/backend truth workers run before any actionable transaction UI.
3. **Wave A progress (rolling, ~2 concurrent workers):** app strict typing — **PASS** (tsc 0 errors from 52; build green without ignore flags; @ts-nocheck removed; Next 15 Promise params fixed); backend build gate — **PASS** (NodeNext `.js` imports fixed; build clean; 286/286 tests green). G1 — **RESOLVED** (§3 above; recharts removed; naming corrections synced to AGENTS.md/CLAUDE.md/CONTEXT.md).
4. **Wave B — COMPLETE (protocol + backend truth):** basket CPI **PASS** (all instructions real; pause-gate shipped — `mint_in_kind` remaining_accounts is now 4n: 3n token triplets + n WhitelistedMint PDAs, `PausedNewMints` → `MintPaused`; redeem byte-identical, structurally proven gate-free; **178 Rust tests**). Whitelist+factory **PASS** (atomic seeds, genesis 1M with temp-authority handoff, real vault_bump). Backend DB/indexer **PASS** (normative §7 schema live-verified, event decode, holdings sync + f64 multiplier, 328 TS tests). Backend NAV/API **PASS** (exact BigInt fixed-point NAV, all §8-9 routes real with `source`/`asOf` markers, zap quotes honest-503, fee crank builds unsigned txs — backend never signs; **373 TS tests**). Rust 178 + TS 373 (+1 legacy) = 552 tests green.
5. **Wave C — foundation done, page groups rolling:** shell/wallet/states/format foundation **PASS** (12 routes, wallet states complete). Running: C-research (Explore/Market/Stock/Providers + @types/d3-* durable fix + optional @bklit/legend) and C-basket (detail/Buy/Redeem + client-side Anchor instruction builders mirroring program source incl. the 4n contract). Queued: C-onboarding (Create wizard/Portfolio/Landing/Legal/Creator), E2E scripts worker.
6. **Wave D static QA — PASS:** regression green (178 Rust + 373 backend TS + app tsc 0 errors + 12-route build); 9 a11y findings fixed (focus traps, APG tabs, focus return, slider token); anti-slop sweep clean (product `transition-all` 0, hardcoded colors 0, dead BasketCard removed, chart-brush English + de-duplicated); release-gate table (§6) 8/8 evidenced PASS. Pending final integration: wave-boundary `npm install` (phantom/solflare/buffer declarations landed in manifests), legend wiring decision, ESLint config, browser QA pass, commits.
7. **In flight:** localnet E2E + SBF toolchain worker (G2) — the last implementation worker. Documentation synced: AGENTS.md/CLAUDE.md/CONTEXT.md/docs/AGENT_CONTEXT.md (552-test status, 4n contract), README.md + app/README.md (operator truth), spec Amendment 2.
