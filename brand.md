# Brand — FolioX

Onchain strategy baskets powered by xStocks. "Create an index. Own your thesis."

_Last updated 2026-09-03 (Roman identity layer added — see "Roman layer" below). Supersedes Mineral Desk (2026-09-01). Telemetry: **off**._

## Roman layer (branch `roman-empire`, owner experiment)

Layered ON TOP of the monochrome system, minimally:

- **Display font: Cinzel** (Trajan-esque capitals, `next/font/google` as `--font-display`, exposed as `.font-display`/`.text-display` utilities) — hero headline, "FolioX" wordmark, section labels only. Everything else Geist/Geist Mono.
- **Roman numerals**: home gateway I/II/III (small, quiet), wizard stepper I-VI (mono, small).
- **Logo: plain laurel wreath** (open top, two mirrored stroke branches) — no monogram letter. Header 20-22px, favicon simplified for 16px legibility. Same wreath on apple-icon + OG.
- **Imperial accents, two spots only**: `--imperial` (Tyrian purple) on the hero eyebrow chip + Tokenized ledger ticks/underline; `--pompeian` (Pompeian red) on gateway ↗ hover. UI chrome stays monochrome otherwise; red on chrome = errors only.
- **Hero art**: Francesco Piranesi's 1790 Pantheon etching (public domain, Wikimedia) inverted to faint lines at 0.11 opacity behind the hero copy, four-edge dissolve masks, plate positioned at `top-62%` with a strengthened top fade (see `docs/roman-imagery-sources.md` for all imagery licenses).
- **Rule**: the Roman layer appears on Home + wizard stepper + wordmark. Utility pages stay pure monochrome. Baskets are never called "ETFs" in product copy.

## Direction

**Monochrome.** Classic shadcn look: near-black canvas, white primary button, grayscale everything — with ONE exception: chart DATA may use the ethereal palette below. No decorative gradients, no accent hue on UI chrome, no site footer, minimal prose everywhere.

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

**Don't:** gradients/neon/marquee/faux chrome; fabricated numbers; `transition-all`; per-component token overrides; projected-yield or performance-promise language; more than one accent on chrome (there is none — red is errors only).
