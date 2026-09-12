# Brand — Basalt

Onchain strategy baskets powered by xStocks. "Create an index. Own your thesis."

_Last updated 2026-09-12 (project renamed **FolioX → Basalt**; identity is the **BASALT MARK** — hexagonal basalt columns, per `docs/design-basalt-v1.md`, which supersedes the FOUNDRY MARK of the NEON FOUNDRY pass and completes the retirement of the 2026-09-03 Roman layer). Token system inherited unchanged from `docs/design-cyberpunk-yellow-v1.md` §2–4. Supersedes Mineral Desk (2026-09-01). Telemetry: **off**._

## BASALT identity (owner decision 2026-09-12)

The laurel/Pantheon/roman-numeral identity is fully retired; the FOUNDRY MARK is superseded. The product name is **Basalt** — basalt cools into hexagonal columns locked side by side (the Giant's Causeway); a basket locks real xStocks into one immutable formation held as a single token. Columns = constituents, column heights = weights, one formation = one token.

- **Canvas + one loud color** (inherited, unchanged): dark industrial near-black with **electric yellow** (`--primary`, #FCEE0A) used with discipline — primary buttons, focus rings, key CTAs, hero accents. Neon cyan/magenta/green/violet live **only inside data** (charts, deltas, avatars), never on chrome.
- **Display font: Chakra Petch** (weights 500/600/700, `next/font/google` as `--font-display`, `.font-display`/`.text-display` utilities) — wordmark, page/section headings, hero stat numerals.
- **Geist Mono terminal labels**: every uppercase micro-label, eyebrow, numeral and price is mono — tracked, quiet, terminal-style. Zero-padded numerals `01`–`06`.
- **BASALT MARK (the logo)** — canonical geometry in `site-header.tsx` `LogoMark`, spec `docs/design-basalt-v1.md` §2: three hexagonal columns of descending height on a shared baseline (viewBox 0 0 24 24, stroke-width 1.7, miter). Reads as basalt columns, as index weights rendered as column heights, and as an ascending stack. Filled `#FCEE0A` renditions (favicon / apple-icon / OG) add cap-facet seams at ≥100px sizes.
- **Wordmark rule**: mark + `B` in `text-primary`, `asalt` in foreground, Chakra Petch; the `· xStocks baskets` suffix stays Geist Mono-adjacent quiet.
- **Motifs**: line-art terminal geometry — the hero watermark is a **causeway tessellation** (seven-hexagon honeycomb = columns seen top-down, `page.tsx`), plus stacked weight-bars, hexagon + plus, `//` chip decorations, terminal-prompt window. No photos, no engravings, no laurel geometry.
- **Home order ("proof beats process", 2026-09-12)**: hero → live proof band (verified trades + top baskets previews) → CREATE · MINT · SHARE steps → SAME EXPOSURE rails ledger → intent cards (Browse baskets / Follow top traders / Open the feed / Build your own).
- **Rule**: the BASALT identity appears on Home + wordmark + stepper numerals; utility pages follow the base system. Baskets are never called "ETFs" in product copy.

## Direction

**Monochrome base + electric yellow layer.** Classic shadcn look: near-black canvas, grayscale everything — with the yellow accent layer and ONE exception: chart DATA may use the neon palette. No decorative gradients, no site footer, minimal prose everywhere.

## Palette (applied in `app/app/globals.css`)

| Role | Dark | Light |
|---|---|---|
| background | `0 0% 3.9%` | `0 0% 100%` |
| card | `0 0% 7%` | white |
| primary / primary-foreground | white 98% / near-black 9% | near-black / white |
| border / muted / accent | neutral grays | neutral grays |
| destructive | muted red — **errors only** | muted red |

**Chart data colors (`--chart-1..5`, "ethereal" per user decision 2026-09-03):** soft sage-mint `hsl(150 30% 70%)` · soft rose `hsl(350 35% 72%)` · powder blue `hsl(215 35% 72%)` · sand `hsl(40 30% 68%)` · lavender `hsl(265 30% 74%)` (dark mode; light slightly deeper). Benchmarks render as **muted gray dashed**. Series strokes 1.5px, fills ≤6% opacity. Up/down direction coloring on 24h changes uses these tokens — red is reserved for errors on chrome.

## Typography — Geist + Geist Mono

Geist for UI copy; **Geist Mono for every number, address, bps, raw/scaled value** (`font-mono tabular-nums`). Wired via `next/font/google` in `app/app/layout.tsx` (`--font-sans`, `--font-mono`). Never swap to `<link>` tags.

## Layout rules

- Pages fill the viewport (`flex min-h-screen flex-col` shell, `flex-1` main). **No site footer** (removed by owner decision).
- Cards: canonical padding system in `components/ui/card.tsx` (Header `p-5 pb-3`, Content `p-5 pt-0`, `first:pt-5` headerless).
- Tables: h-11 rows, hover `bg-muted/40`, right-aligned tabular numerics.
- Range/toggle controls: plain text buttons (active = foreground + medium), never boxed pill wrappers.

## Tone and voice

Short, factual, number-forward. One sentence per idea; details live one click deeper. Say what an action does, not what it feels like. Compliant vocabulary only: **strategy basket / index basket / onchain equity basket / xStocks-backed strategy token** — never "ETF", "fund", "guaranteed", "safe", "financial advice" (hard legal ban, see AGENTS.md §1). No hype words, no exclamation marks, no emojis.

**Legal review markers:** `LEGAL_REVIEW_REQUIRED` chips were removed from the UI at owner request (2026-09-03); the review items live in the backlog (`plan.md`) — the wizard's legal-checkbox step and `/legal` page remain functional and must not be deleted. Counsel review is still required before any mainnet launch.

## Do / Don't

**Do:** tokens only (no hardcoded hex); `ChangeValue` helper for 24h coloring; FreshnessBadge for source/as-of; honest empty states ("not indexed" chips); demo data clearly marked (`demo-seed`).

**Don't:** gradients/neon/marquee/faux chrome (on the cyberpunk-yellow branch the sanctioned exceptions are the electric-yellow accents and the `.glow-primary`/`.text-glow`/`.hairline-primary` utilities, used sparingly); fabricated numbers; `transition-all`; per-component token overrides; projected-yield or performance-promise language; more than one accent on chrome (base: none — red is errors only; cyberpunk-yellow branch: exactly one — electric yellow).
