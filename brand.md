# Brand — FolioX

Onchain strategy baskets powered by xStocks. "Create an index. Own your thesis."

_Last updated 2026-09-12 (NEON FOUNDRY identity layer on branch `design/cyberpunk-yellow` — see "NEON FOUNDRY layer" below; it retires the 2026-09-03 Roman layer **on that branch only**). Supersedes Mineral Desk (2026-09-01). Telemetry: **off**._

## NEON FOUNDRY layer (branch `design/cyberpunk-yellow`, owner experiment)

Layered ON TOP of the base system, minimally — the laurel/Pantheon/roman-numeral identity is retired on this branch:

- **Canvas + one loud color**: dark industrial near-black with **electric yellow** (`--primary`, #FCEE0A) used with discipline — primary buttons, focus rings, key CTAs, hero accents. Neon cyan/magenta/green/violet live **only inside data** (charts, deltas, avatars), never on chrome.
- **Display font: Chakra Petch** (weights 500/600/700, `next/font/google` as `--font-display`, `.font-display`/`.text-display` utilities) — wordmark, page/section headings, hero stat numerals. Cinzel is gone.
- **Geist Mono terminal labels**: every uppercase micro-label, eyebrow, numeral and price is mono — tracked, quiet, terminal-style. Zero-padded numerals `01`–`06` replace roman numerals everywhere.
- **FOUNDRY MARK (the logo)**: a hexagon outline containing three descending horizontal bars — reads as "index weights in a container" and abstractly as an angular F. Same mark on the header wordmark (the X in the wordmark renders yellow), favicon and OG/apple icons. No laurel geometry anywhere.
- **Motifs**: line-art terminal geometry only — stacked weight-bars, hexagon + plus, `//` chip decorations, terminal-prompt window, faint inline-SVG circuit-blueprint hero watermark. No photos, no engravings.
- **Home order ("proof beats process", 2026-09-12)**: hero → live proof band (verified trades + top baskets previews) → CREATE · MINT · SHARE steps → SAME EXPOSURE rails ledger → intent cards (Browse baskets / Follow top traders / Open the feed / Build your own).
- **Rule**: the NEON FOUNDRY layer appears on Home + wordmark + stepper numerals; utility pages follow the base system. Baskets are never called "ETFs" in product copy.

## Direction

**Monochrome** (base system; on branch `design/cyberpunk-yellow` the NEON FOUNDRY layer above supersedes it — near-black + electric yellow). Classic shadcn look: near-black canvas, white primary button, grayscale everything — with ONE exception: chart DATA may use the ethereal palette below. No decorative gradients, no accent hue on UI chrome, no site footer, minimal prose everywhere.

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
