# Basalt — Visual Identity Spec (v1)

> Owner direction 2026-09-12: the project renames **FolioX → Basalt** and the
> identity becomes the **hexagonal basalt columns** — no Roman layer. This
> spec supersedes the FOUNDRY MARK (design-cyberpunk-yellow-v1 §7) while
> **inheriting its full token system unchanged**: near-black canvas,
> electric-yellow `#FCEE0A` primary with discipline, Chakra Petch display,
> Geist Mono terminal labels, neon data colors only inside charts, sharp
> corners. Dark mode is the flagship. No IA/layout changes, no new libraries.

## 1. Concept — "columns of real stock"

Basalt cools into hexagonal columns locked side by side (the Giant's
Causeway). The product does the same: real xStocks locked into one immutable
formation you hold as a single token.

- **Columns = constituents.** A basket's weights render as column heights —
  the mark IS the product diagram.
- **One formation = one token.** Many columns, one causeway; many stocks,
  one share token.
- **Palette**: charcoal near-black canvas + electric yellow (molten accent)
  — volcanic industrial, not neon soup. Everything else inherited from
  cyberpunk-yellow-v1 §2 unchanged.
- Restraint rule carries over: if everything glows, nothing does.

## 2. The BASALT MARK (canonical geometry)

Three hexagonal columns of **descending height on a shared flat baseline**.
Reads as: basalt columns → index weights as column heights → an ascending
stack. ViewBox `0 0 24 24`; UI/stroke rendering uses `currentColor`,
stroke-width `1.7`, miter joins; mark bbox spans x 4.3–19.7, y 2.5–21.5.

| column | path (d) | height (units) |
|---|---|---|
| tall | `M4.3 3.7 L6.5 2.5 L8.7 3.7 L8.7 21.5 L4.3 21.5 Z` | 19 |
| mid | `M9.8 10.7 L12 9.5 L14.2 10.7 L14.2 21.5 L9.8 21.5 Z` | 12 |
| short | `M15.3 15.7 L17.5 14.5 L19.7 15.7 L19.7 21.5 L15.3 21.5 Z` | 7 |

Geometry facts (keep in sync if ever redrawn): column width 4.4, gap 1.1,
side margins 4.3, shared baseline y 21.5, bevel 1.2 (the pointed top facets
read as hexagonal caps seen in slight perspective). Descending heights
deliberately echo the retired FOUNDRY MARK's descending weight bars and the
weights-editor UI.

**Canonical source**: `LogoMark` in `app/components/shell/site-header.tsx`.
All other renditions reuse the same 24×24 relative geometry.

## 3. Renditions

| surface | file | rendering |
|---|---|---|
| Header wordmark | `site-header.tsx` | stroke mark (currentColor) + `B` in `text-primary`, `asalt` in foreground, Chakra Petch |
| Favicon | `app/app/icon.svg` | **filled** columns `#FCEE0A` on `#0A0A0B` rx 4, 1.2× centered scale, no seams (fills read at 16px) |
| Apple touch icon | `app/app/apple-icon.tsx` | filled columns + **cap-facet seams** (`#0A0A0B` 0.55-unit lines at each bevel base y 3.7/10.7/15.7) |
| OG image | `app/app/opengraph-image.tsx` | filled columns + seams at 220px, wordmark `BASALT`, yellow badge `XSTOCKS STRATEGY BASKETS · SOLANA`, yellow corner ticks, hairline grid |

Seam rule: the cap-facet seam appears only where the mark renders ≥100px;
below that it is visual noise.

## 4. Causeway tessellation (ambient motif)

Seven pointy-top hexagons (R 68, honeycomb cluster) = columns seen top-down.
Used as the hero watermark (inline SVG in `app/app/page.tsx`): white strokes
at 7% opacity, square node dots on cell centers, straight connector traces
between centers, heavy top fade + radial text scrim. Replaces the retired
concentric-hexagon "circuit blueprint". Section motifs elsewhere
(flow-section step 02 hexagon+plus, `//` chips, zero-padded mono numerals)
stay as-is — already consistent with Basalt.

Reference cluster (600×600 viewBox, center cell at 300,300, R 68, ring at
√3·R ≈ 117.8 along the edge-normal directions 0°/60°/…/300° — pointy-top
cells share edges, they never overlap): center `(300,300)`; ring centers
`(417.8,300) (358.9,198) (241.1,198) (182.2,300) (241.1,402) (358.9,402)`.

## 5. Naming & voice

- Product name: **Basalt** (always capitalized, never all-caps in prose; OG
  wordmark is the exception). Never "Basalt ETF" / "Basalt fund" — the
  standing AGENTS §1 legal ban on ETF/fund/guaranteed/safe/advice language
  applies unchanged. Use: strategy basket / index basket / onchain equity
  basket / xStocks-backed strategy token.
- Tagline: "Create an index. Own your thesis." (unchanged).
- One-liner for hackathon/social: **"Basalt — one token, a column of real
  stocks, on Solana."**
- Tone rules inherited from brand.md: short, factual, number-forward, no
  hype, no exclamation marks, no emojis.

## 6. What changed vs what didn't

Changed: brand name everywhere (docs, UI strings, package names
`basalt-app`/`basalt-backend`, spec `docs/basalt-v0-spec.md`), the mark,
favicon/apple/OG renditions, hero watermark, wordmark accent (trailing X →
leading B).

Unchanged (inherited from cyberpunk-yellow-v1): all color tokens in
`app/app/globals.css`, Chakra Petch/Geist/Geist Mono typography, layout
rules, component rules, `.bg-grid`/`.glow-primary`/`.text-glow`/
`.hairline-primary` utilities, home page order ("proof beats process").

Historical artifacts intentionally NOT renamed: `foliox_build_prompt.md`
(original prompt), `docs/devnet-live-2026-09-04.md` (dated evidence pack),
`backend/.devnet-live-evidence.json` (deploy evidence), local Postgres db
names (`foliox`, `foliox_devnet` in `.env*`).

## 7. Verification

1. `grep -rn "FolioX\|FOLIOX" app backend docs *.md` → only the four
   historical artifacts above may match.
2. `npx tsc --noEmit` and `npm run build` in `app/` → clean.
3. Backend `npm run test -- --run` → all green (sweep touched strings only).
4. Eyeball: favicon at 16/32px, header wordmark on dark, OG card.
