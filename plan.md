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

### G0 — brand and telemetry

The repository has no root `brand.md`. Before frontend components are written, choose one:

- Run `brand-design` and create a deliberate palette, typography, and voice.
- Defer brand setup and explicitly document the provisional neutral theme.

The recommended provisional direction is the design-audit palette: warm near-black canvas, warm raised surfaces, restrained mineral-mint action accent, sage/clay/ochre semantic statuses, Geist for UI copy, and Geist Mono for numeric/onchain data. These values are a proposal, not an approved brand until the user decides.

The frontend skill also requires a one-time telemetry choice: anonymous or off. Do not write a brand file or change telemetry configuration implicitly.

### G1 — registry provenance

Confirm the exact Bklit registry sources and generated files before claiming Bklit compliance. `app/components.json` contains the `@bklit` registry namespace, but the current source tree is mostly local implementations backed by `@visx`; the local brush component is explicitly a placeholder and the audit found the official brush endpoint unavailable. Use the official registry where available, document any supported local adapter, and never label a local substitute as an official Bklit component without evidence.

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
| 2026-09-01 | G0 resolved by user: run `brand-design` now to create the deliberate brand; telemetry = off; brand.md is written before design tokens | user | Decided |
| 2026-09-01 | G2 resolved by user: localnet end-to-end milestone first; no actionable mint/redeem UI before protocol truth | user | Decided |
| 2026-09-01 | Orchestration moved to ZCode coordinator with Agent subagents in waves (A foundation, B protocol/backend, C pages, D QA); disjoint file ownership enforced per wave | user/coordinator | Active |

## 8. Immediate next actions

Status as of 2026-09-01 (user decisions recorded in §7):

1. ~~User chooses brand/telemetry~~ — Done: `brand-design` now, telemetry **off** (G0 decided).
2. Coordinator runs `brand-design`, writes `brand.md`, then dispatches the Wave A tokens worker against it.
3. ~~G2 choice~~ — Done: **localnet E2E first**; Wave B protocol/backend truth workers run before any actionable transaction UI.
4. Wave A (parallel, disjoint scopes): design tokens from `brand.md`, app strict typing/build gate, backend build gate, G1 registry provenance research. Protocol workers (programs/*) dispatch in parallel — disjoint from app/backend scopes.
5. Wave B-backend workers dispatch only after the backend build gate is green; Wave C page workers only after the foundation and ownership map are stable.
