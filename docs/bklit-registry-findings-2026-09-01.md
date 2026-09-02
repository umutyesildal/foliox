# Bklit Registry Findings — 2026-09-01 (G1: Registry Provenance)

> Read-only research report for `plan.md` §3 G1 and §4 Phase 3 tasks 4–5. No project source files
> were edited to produce this document. All HTTP status codes and content diffs below were verified
> live on 2026-09-01 against the official Bklit registry and compared byte-for-byte against the
> local tree in `app/components/charts/`.

## 1. Executive summary

1. The official Bklit registry **is real, live, and reachable** at `https://bklit.com/r/{name}.json`
   (the documented `https://ui.bklit.com/r/{name}.json` responds with `301` → `bklit.com`; both work).
2. The earlier audit's suspicion that the local `@visx` chart tree is "not really Bklit" is
   **resolved — in Bklit's favor**: the official Bklit chart components are themselves `@visx`-backed
   (pinned `@visx/*@4.0.1-alpha.0` + `motion`), exactly matching `app/package.json`. The local chart
   tree is overwhelmingly **byte-identical to the official registry source** (see §5).
3. **Brush is the genuine gap**: the official docs document a `ChartBrush`/`ChartBrushLayout` API,
   but no registry item distributes its source (`/r/brush.json` → 404, `/r/chart-brush.json` → 404,
   absent from the registry index and from every chart payload). The local `chart-brush.tsx` is a
   hand-written placeholder adapter implementing the *documented* API — it must never be labeled
   official Bklit source.
4. Two registry item names in `AGENTS.md` §3/§10 are wrong: the official names are
   `candlestick-chart` (not `candlestick`) and `chart-tooltip` (not `tooltip`).
5. The root `recharts@^3.10.1` dependency has **zero imports anywhere in the repo** (only
   `package.json` + `package-lock.json` mention it) and Bklit itself has no recharts dependency —
   removal is safe (§8).

## 2. Official installation procedure (verified verbatim)

Source: https://bklit.com/docs/installation (fetched 2026-09-01).

1. Prerequisite — shadcn/ui must be initialized first:

   ```bash
   npx shadcn@latest init
   ```

2. Registry configuration — the page's verbatim JSON block:

   ```json
   {
     "registries": {
       "@bklit": "https://ui.bklit.com/r/{name}.json"
     }
   }
   ```

   Bklit "is published on the shadcn registry index as `@bklit`"; the namespace is auto-configured
   for new projects. `app/components.json` lines 24–26 already contain this exact entry.

3. Install components (npx example quoted verbatim on the installation page; component docs pages
   show the pnpm variant):

   ```bash
   npx shadcn@latest add @bklit/area-chart
   pnpm dlx shadcn@latest add @bklit/area-chart     # pnpm variant, quoted on component pages
   ```

   All other components follow `npx shadcn@latest add @bklit/{name}`. An install "Install[s] any
   required dependencies automatically" alongside copying source into `components/charts/`.

## 3. Verified official component inventory

Registry index: https://bklit.com/r/registry.json (fetched 2026-09-01). HTTP status verified for
every item below; dependency lists extracted verbatim from each registry JSON.

### 3.1 Chart components (all HTTP 200)

| Registry item | Title | npm `dependencies` (verbatim) | `registryDependencies` |
|---|---|---|---|
| `area-chart` | Area Chart | `@visx/curve@4.0.1-alpha.0`, `@visx/gradient@4.0.1-alpha.0`, `@visx/shape@4.0.1-alpha.0`, `motion` | chart-context, chart-animation, chart-series, grid, x-axis, chart-tooltip, shimmering-text, utils |
| `line-chart` | Line Chart | `@visx/curve@4.0.1-alpha.0`, `@visx/shape@4.0.1-alpha.0`, `motion` | chart-context, chart-animation, chart-series, grid, x-axis, chart-tooltip, shimmering-text, utils |
| `bar-chart` | Bar Chart | `@visx/gradient@4.0.1-alpha.0`, `@visx/pattern@4.0.1-alpha.0`, `@visx/shape@4.0.1-alpha.0`, `motion` | chart-context, chart-animation, grid, chart-tooltip, utils |
| `candlestick-chart` | Candlestick Chart | `@visx/scale@4.0.1-alpha.0`, `@visx/responsive@4.0.1-alpha.0`, `d3-array`, `motion` | chart-context, chart-animation, grid, x-axis, y-axis, chart-tooltip, utils |
| `composed-chart`, `profit-loss-line`, `live-line-chart`, `scatter-chart`, `pie-chart`, `radar-chart`, `ring-chart`, `gauge-chart`, `heatmap-chart`, `choropleth-chart`, `funnel-chart`, `sankey-chart`, `sunburst-chart`, `bar-depth` | present in index (HTTP 200 spot-checked where fetched) | not extracted (not needed for the FolioX contract) | — |

### 3.2 Utility components (all HTTP 200)

| Registry item | Title | npm `dependencies` (verbatim) | `registryDependencies` |
|---|---|---|---|
| `grid` | Chart Grid | `@visx/grid@4.0.1-alpha.0` | chart-context |
| `chart-tooltip` | Chart Tooltip | `@number-flow/react`, `motion` | chart-context, utils |
| `legend` | Chart Legend | `@base-ui/react`, `@number-flow/react` | utils, chart-utils |
| `x-axis` | X Axis | (in payload) | chart-context |
| `y-axis` | Y Axis | (in payload) | chart-context |
| `chart-context`, `chart-animation`, `chart-series`, `chart-utils` | transitive infrastructure | chart-utils ships `chart-formatters.ts`, `decimate-time-series.ts`, `use-scheduled-tooltip.ts` | — |
| `shimmering-text` | Shimmering Text | (in payload) | — |
| `utils`, `background`, `reference-area`, `projection-line`, `markers`, `chart-stat-flow` | present in index | — | — |

### 3.3 Names that do NOT exist (HTTP 404 verified)

| URL probed | Status | Note |
|---|---|---|
| `https://bklit.com/r/brush.json` | **404** | The critical gap — see §4 |
| `https://bklit.com/r/chart-brush.json` | **404** | Alternate name also missing |
| `https://bklit.com/r/candlestick.json` | 404 | Official name is `candlestick-chart` |
| `https://bklit.com/r/tooltip.json` | 404 | Official name is `chart-tooltip` (docs: https://bklit.com/docs/utility/tooltip quotes `pnpm dlx shadcn@latest add @bklit/chart-tooltip`) |
| `https://bklit.com/r/use-chart.json` | 404 | `useChart` is a docs utility page only |
| `https://bklit.com/r/axis/x-axis.json`, `/r/axis/y-axis.json` | 404 | Docs paths `/docs/utility/axis/*` are pages; registry names are `x-axis` / `y-axis` |

## 4. Brush verification (research question 2 — re-verified)

- Docs page exists: https://bklit.com/docs/utility/brush (found via the installation page nav and
  `https://bklit.com/sitemap.xml`). It documents a **time-range brush pattern**:
  - "ChartBrush and ChartBrushLayout ship with time-series charts. Install the area chart (or line
    chart) registry item, then import from your charts package:
    `import { AreaChart, Area, ChartBrush, ChartBrushLayout, Grid, XAxis, ChartTooltip } from "@/components/charts"`."
  - Usage: wrap the main chart in `ChartBrushLayout`; render a mini chart in `brushStrip` with
    `ChartBrush` as a child; pass `xDomain`, `xDomainSlotCount`, and
    `tweenYDomainOnXDomainChange` to the main chart so it zooms and tweens the y-scale.
  - `ChartBrushLayout` "Owns brush selection state and derives `xDomain` for the main chart"
    (props: `data`, `enabled`, `height`, `brushStrip`); `ChartBrush` takes
    `initialSelection` / `onSelectionChange`.
- **However, no distributable source exists in the registry:**
  - `https://bklit.com/r/brush.json` → 404 and `https://bklit.com/r/chart-brush.json` → 404.
  - The registry index (`/r/registry.json`) contains **no brush item** (only a CSS variable string
    `--chart-brush-border`).
  - The `area-chart`, `line-chart`, `composed-chart`, and `bar-chart` payloads contain **zero**
    `ChartBrush` source files. The single "ChartBrush" mention in each payload is a
    component-name recognition branch inside the official `chart-child-passthrough.ts`
    (`componentName === "ChartBrush"`).
- **Conclusion:** the official Brush is a *documented API pattern without a published registry
  item* (docs-vs-registry mismatch, re-confirmed on 2026-09-01; the earlier audit's 404 finding
  stands). Any Brush in FolioX must be labeled a **local adapter implementing the documented Bklit
  Brush API**, never "official Bklit source".
- Related upstream defect found: the official `time-series-chart-shell.tsx` (shipped inside
  `area-chart.json`/`line-chart.json`) imports `./filter-data-by-x-domain`, but that file is **not
  shipped in any fetched payload** (checked `area-chart`, `line-chart`, `chart-utils`). The local
  tree contains `app/components/charts/filter-data-by-x-domain.ts`, which fills this hole. A fresh
  `npx shadcn@latest add @bklit/area-chart` today would produce a broken import until Bklit fixes
  the payload.

## 5. Local-vs-official provenance (byte-level diff, 2026-09-01)

Method: each official registry JSON's embedded `files[].content` was compared (stripped-trailing-
whitespace equality; `difflib.QuickRatio` for near-matches) against
`app/components/charts/` (+ `app/components/shimmering-text.tsx`).

| Official item | Files | Byte-identical | Minor local edits | Missing locally |
|---|---|---|---|---|
| `area-chart` | 14 | 12 | `line-loading-timing.ts` (~0.93), `chart-loading-label.tsx` (~1.00) | none |
| `line-chart` | 16 | 14 | same two files as above | none |
| `bar-chart` | 13 | 12 | `bar-depth-geometry.ts` (~0.86 — locally modified) | none |
| `candlestick-chart` | 4 | 4 | none | none |
| `grid` | 2 | 2 | none | none |
| `chart-tooltip` | 9 | 8 | `indicator-fade.ts` (~0.98) | none (local copy lives in `charts/tooltip/`) |
| `x-axis` | 1 | 1 | none | none |
| `y-axis` | 2 | 1 | `y-axis.tsx` (~1.00) | none |
| `chart-context` | 12 | 9 | `y-axis-ticks.ts`, `chart-phase.ts`, `line-loading-timing.ts` | none |
| `chart-animation` | 7 | 7 | none | none |
| `chart-series` | 15 | 13 | `path-stroke-utils.ts`, `fade-edges.ts` | none |
| `chart-utils` | 3 | 2 | `decimate-time-series.ts` (~0.98) | none |
| `shimmering-text` | 1 | 1 (target `components/shimmering-text.tsx`) | none | none |
| `legend` | 8 | 0 | — | **all 8 files — official Legend is NOT installed** |

Local-only files (not part of any fetched official payload):

- `app/components/charts/chart-brush.tsx` — hand-written placeholder; line 299 comment:
  `// Placeholder for bklit ChartBrush — visual brush is handled by ChartBrushLayout slider.`
  Implements the documented `ChartBrushLayout`/`ChartBrush` API (`brushStrip`, `xDomain`,
  `xDomainSlotCount`, `onSelectionChange`) and is consumed by `app/app/stock/[ticker]/StockChart.tsx`
  and `app/app/stock/[ticker]/CandleVolumeChart.tsx`.
- `app/components/charts/filter-data-by-x-domain.ts` — fills the official shell's unshipped import
  (see §4 defect); effectively required for the official shell to compile.
- `app/components/charts/area-gradient-defs.tsx`, `highlight-segment.tsx`,
  `highlight-segment-bounds.ts`, `use-highlight-segment.ts`, `static-chart-preview-context.tsx`,
  `chart-stat-flow.tsx` (an official `chart-stat-flow` item exists separately), and misc. page-level
  helpers — extra local additions, none required by the frozen contract below.

**Verdict on the audit's suspicion:** the local `@visx` implementations are not an imitation of
Bklit — they *are* Bklit. Official Bklit charts depend on `@visx/*@4.0.1-alpha.0` (the exact
versions in `app/package.json`) plus `motion`, `d3-array`, `@number-flow/react`, `@base-ui/react`.
The only genuinely unofficial chart file is the Brush placeholder.

## 6. Frozen chart contract (FolioX V0 — spec charts)

"Official" = registry item returned HTTP 200 and ships source; "Documented local adapter" = exists
only as a docs pattern, source must stay local and clearly labeled.

| Spec-required chart | Official Bklit component? | Install command / action | Local state |
|---|---|---|---|
| AreaChart (normalized multi-series, normalize-100) | **YES** — `@bklit/area-chart` | `npx shadcn@latest add @bklit/area-chart` | Installed; 12/14 files byte-identical. Normalization stays at page level (page contract, not registry). |
| LineChart | **YES** — `@bklit/line-chart` | `npx shadcn@latest add @bklit/line-chart` | Installed; 14/16 byte-identical. |
| BarChart (volume) | **YES** — `@bklit/bar-chart` | `npx shadcn@latest add @bklit/bar-chart` | Installed; 12/13 byte-identical; `bar-depth-geometry.ts` locally modified — re-diff before claiming full provenance. |
| Candlestick (OHLC) | **YES** — `@bklit/candlestick-chart` (NOT `@bklit/candlestick`) | `npx shadcn@latest add @bklit/candlestick-chart` | Installed; 4/4 byte-identical. |
| Grid | **YES** — `@bklit/grid` | `npx shadcn@latest add @bklit/grid` | Installed; 2/2 byte-identical. |
| Tooltip | **YES** — `@bklit/chart-tooltip` (NOT `@bklit/tooltip`) | `npx shadcn@latest add @bklit/chart-tooltip` | Installed (in `charts/tooltip/`); 8/9 byte-identical. |
| Legend | **YES** — `@bklit/legend` | `npx shadcn@latest add @bklit/legend` (not yet run) | **Not installed** — no `charts/legend/` directory. Only `chart-legend-hover.tsx` (part of official `bar-chart`) exists locally. |
| Brush (xDomain zoom) | **NO registry item** — documented pattern only (§4) | No install command exists. Keep the local adapter, labeled "implements the documented Bklit ChartBrush/ChartBrushLayout API — placeholder, not official registry source". Re-check `/r/brush.json` for publication. | `charts/chart-brush.tsx` + `charts/filter-data-by-x-domain.ts` (required by the official shell import). |

Contract rules:

1. Only the items in §3 may ever be described as "official Bklit components", citing the registry
   URL and HTTP-200 payload as evidence.
2. `chart-brush.tsx` and `filter-data-by-x-domain.ts` are **documented local adapters**; any doc,
   comment, or PR describing them as official must be corrected.
3. If Bklit later publishes a Brush item, migrate and re-run the §5 diff before deleting the local
   adapter.
4. `AGENTS.md` §3/§10 and `docs/foliox-v0-spec.md` should be corrected (per plan.md §6 protocol):
   `candlestick` → `candlestick-chart`, `tooltip` → `chart-tooltip`, and the install list should add
   `@bklit/legend`. The `@visx` backing is *official Bklit behavior*, not a compliance failure —
   plain `recharts`/raw-SVG charts remain banned per AGENTS.md §10.

## 7. Registry endpoint notes

- `app/components.json` `registries` entry matches the official docs exactly; the `ui.bklit.com`
  host 301-redirects to `bklit.com`, which the shadcn CLI follows. Keep the documented
  `https://ui.bklit.com/r/{name}.json` value (changing it is optional, not required).
- `app/package.json` already pins every npm dependency the official items declare
  (`@visx/* 4.0.1-alpha.0`, `motion`, `d3-array`, `d3-shape`, `@number-flow/react`,
  `@base-ui/react`). Installing `@bklit/legend` should add nothing new.

## 8. Root `recharts` removal recommendation (plan.md Phase 3 task 5)

Evidence: repo-wide grep (excluding `node_modules`/lockfile) for `recharts` matches only
`package.json:20` (`"recharts": "^3.10.1"`). `package-lock.json` entries are lockfile artifacts of
that single declaration. No `.ts`/`.tsx`/`.js` file in `app/`, `backend/`, `scripts/`, or `tests/`
imports recharts, and official Bklit declares no recharts dependency (§3) — the local charts are
`@visx`-based.

Safe removal procedure (do not run as part of this research):

```bash
# 1. Remove the single line from root package.json dependencies: "recharts": "^3.10.1"
# 2. Regenerate the lockfile from the workspace root:
npm install
# 3. Verify nothing regressed:
grep -rn "recharts" --include="*.ts" --include="*.tsx" --include="*.js" app backend scripts tests  # expect: no output
(cd app && npx tsc --noEmit --incremental false)
npm --prefix backend test -- --run
cargo test --workspace   # unaffected, but cheap insurance per AGENTS.md §15
```

Risk: none identified — recharts is transitively required by nothing else in either workspace.

## 9. Sources (all fetched/verified 2026-09-01)

- Installation guide: https://bklit.com/docs/installation
- Registry index: https://bklit.com/r/registry.json
- Registry items (HTTP status + payload): https://bklit.com/r/area-chart.json ,
  https://bklit.com/r/line-chart.json , https://bklit.com/r/bar-chart.json ,
  https://bklit.com/r/candlestick-chart.json , https://bklit.com/r/grid.json ,
  https://bklit.com/r/chart-tooltip.json , https://bklit.com/r/legend.json ,
  https://bklit.com/r/x-axis.json , https://bklit.com/r/y-axis.json ,
  https://bklit.com/r/chart-context.json , https://bklit.com/r/chart-animation.json ,
  https://bklit.com/r/chart-series.json , https://bklit.com/r/chart-utils.json ,
  https://bklit.com/r/shimmering-text.json , https://bklit.com/r/chart-stat-flow.json ,
  https://bklit.com/r/markers.json , https://bklit.com/r/bar-depth.json
- 404-verified: https://bklit.com/r/brush.json , https://bklit.com/r/chart-brush.json ,
  https://bklit.com/r/candlestick.json , https://bklit.com/r/tooltip.json ,
  https://bklit.com/r/use-chart.json , https://bklit.com/r/axis/x-axis.json ,
  https://bklit.com/r/axis/y-axis.json
- Docs pages: https://bklit.com/docs/utility/brush , https://bklit.com/docs/utility/tooltip ,
  https://bklit.com/docs/components/area-chart , https://bklit.com/docs/utility/legend ,
  https://bklit.com/sitemap.xml
- Local files audited: `app/components.json`, `app/package.json`, root `package.json`,
  `app/components/charts/*` (81 files), `app/app/stock/[ticker]/StockChart.tsx`,
  `app/app/stock/[ticker]/CandleVolumeChart.tsx`
- Context: `AGENTS.md` §3/§10/§24, `plan.md` §3 G1 + §4 Phase 3 tasks 4–5,
  `docs/ui-discovery-2026-09-01.md`
