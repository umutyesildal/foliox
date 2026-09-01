# FolioX UI and Coordination Discovery — 2026-09-01

## Scope

This is a read-only audit of the shared `createyouretf` worktree after the earlier UI worker wave. It records what is actually present, not what older scaffolding notes intended to be present. No source files were edited by the discovery workers.

## Orca run

- New supervised Run: `run_b38cb1bbcd0c`
- Workers: UI audit, design system audit, implementation readiness audit
- Result: all three completed successfully; settled worker terminals were released.
- Older UI Run `run_7f4b8dbc5e4f` remains historical and was not mutated.

## Current implementation truth

### Frontend

Already using local Card/Badge/Table and local chart APIs:

- `app/app/page.tsx`
- `app/app/explore/page.tsx`
- `app/app/basket/[pubkey]/page.tsx`
- `app/app/create/page.tsx`
- `app/app/providers/page.tsx`
- `app/app/stock/[ticker]/StockChart.tsx`

Still visibly scaffolded or incomplete:

- `app/app/basket/[pubkey]/buy/page.tsx`
- `app/app/basket/[pubkey]/redeem/page.tsx`
- `app/app/portfolio/page.tsx`
- `app/app/legal/page.tsx`
- missing `app/app/creator/[pubkey]/page.tsx`
- missing explore loading route

The app has the Bklit registry namespace in `app/components.json`, but the chart source tree is local and imports `@visx`. `app/components/charts/chart-brush.tsx` contains an explicit placeholder implementation rather than a verified official Bklit Brush source. Do not describe the current source tree as fully registry-backed until G1 is complete.

### Backend and protocol

- `/baskets` is backed by an empty in-memory array in the current server rather than the documented database/indexer path.
- Zap quote legs, multiplier reads, basket discovery, event decoding, and holdings/NAV wiring are incomplete or mocked.
- The Anchor programs contain math and unit tests, but factory/basket transfer, share mint/burn, and fee-mint behavior remain stubbed in instruction bodies.
- Wallet provider packages are installed but not wired into the application shell.

### Verification baseline

- Rust: `cargo test --workspace` passed 114 tests.
- Backend: `npm --prefix backend test -- --run` passed 286 tests.
- Root legacy TypeScript test: 1 passed, so the documented combined TypeScript count is 287.
- App build: passes only with Next type/lint errors ignored by `app/next.config.js`.
- App strict typecheck: fails on Next 15 Promise route params, unsupported component props, chart typing, React DOM types, and ES2015+ target issues.
- Backend build: fails NodeNext relative-import and implicit-any errors.
- Git: the project files are currently untracked; previous worker edits are not separated by commits.

## Design direction

### Direction

Dark-native quiet research terminal: Workstation Dense information architecture plus Warm Monochrome restraint. FolioX should feel like a trustworthy onchain research surface where composition, provenance, drift, and redemption mechanics command attention.

### Provisional tokens

These are worker recommendations only; they require the G0 brand decision before implementation:

- Canvas: `#11110F`
- Surface: `#181815`
- Raised: `#1F1F1B`
- Sunken: `#0D0D0B`
- Border: `#2C2C27`
- Strong border: `#42423A`
- Text: `#F1F0E9`
- Muted: `#B4B3AA`
- Faint: `#7B7A71`
- Primary action: mineral mint `#A8CDC8`, strong `#75BDB6`
- Semantic status: sage positive, clay negative, ochre caution/legal, restrained blue info
- Charts: xStock `#9FBDF0`, real `#9BC6A8`, benchmark `#888B84` dashed; scope other chart colors to semantic data roles

### Typography and geometry

- Geist for narrative/UI copy; Geist Mono for prices, balances, bps, raw/scaled values, timestamps, addresses, and transaction status.
- Maximum three weights: 400, 500, 600.
- 4/8px spacing grid; 12/16/24/32 spacing scale.
- About 10px panel radius, 6px controls, 4px compact chips; true pills only for selected/live states.
- Low-contrast borders and surface shifts provide hierarchy; avoid universal shadows.
- Motion curve `cubic-bezier(0.23, 1, 0.32, 1)` with short, property-specific transitions and reduced-motion support.

## Page hierarchy

- Shell: compact sticky utility bar, active route, network/freshness, wallet, breadcrumbs, legal footer.
- Landing: asymmetric editorial hero and one primary CTA; data must be sourced or clearly labeled demo/as-of.
- Explore: comparison-first table on desktop; cards are a mobile representation, not duplicate desktop content.
- Detail: identity and immutable parameters, metric strip, dominant historical NAV chart, allocation/drift table, fees, risks, persistent action rail.
- Buy/Redeem: focused transaction workspaces with review/sign status timelines and inline slippage/risk notices.
- Create: six-step form with persistent summary rail and hard validation gates.
- Market/Stock: chart workspaces with required Area/Candlestick/Volume/Brush compositions and source/as-of labels.
- Portfolio: wallet gate, positions table, raw/scaled/multiplier clarity, redeem action.
- Providers: source registry and freshness/status table.
- Legal: reading-width factual disclosure document with visible `LEGAL_REVIEW_REQUIRED`.

## Anti-slop rules

Remove or avoid:

- default blue/violet gradients, neon glows, decorative blur, faux browser chrome, and marquee tickers;
- repeated “large metric + gradient line” cards and nested card stacks;
- blanket pill badges, uniform radii, and multiple competing accent hues;
- fake live or random mock data without demo/as-of labeling;
- dead `<button>`/native controls without labels, focus, pressed, disabled, and loading states;
- `transition-all`, unbounded numeric formatting, and unsupported performance/yield/safety claims.

## Ordered blockers

1. G0 brand/telemetry decision.
2. G1 official Bklit registry provenance and Brush strategy.
3. Shared design tokens, shell, wallet provider, and strict type/build foundation.
4. Protocol and backend truthfulness before executable transaction UI.
5. Page implementation in disjoint worker scopes.
6. Browser, responsive, accessibility, legal, security, and regression gates.

See `plan.md` for task decomposition, dependencies, Orca operating rules, and release gates.
