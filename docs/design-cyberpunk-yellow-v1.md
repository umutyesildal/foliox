# Basalt "NEON FOUNDRY" — Cyberpunk-Yellow Design Spec (v1)

> Owner direction 2026-09-12: explore a cyberpunk-leaning identity built on
> **electric yellow**, with typography re-tuned to match. This branch
> (`design/cyberpunk-yellow`) is the experiment space; it supersedes the
> monochrome decision (AGENTS §10, 2026-09-03) **on this branch only**.
> No IA/route/layout-structure changes, no new libraries (fonts come via
> `next/font/google`, already in use). Both dark and light modes stay
> functional; **dark is the flagship**.

## 1. Concept

Dark industrial near-black canvas, **one loud color: electric yellow** used
with discipline; neon cyan/magenta/green/violet live **only inside data**
(charts, deltas, avatars) — never on chrome. Terminal-flavored details:
mono uppercase labels, sharp corners, yellow hairlines and a faint
engineering grid. Restraint is the brand: if everything glows, nothing does.

## 2. Color tokens (HSL triplets — edit `app/app/globals.css` only)

### `.dark` (default — flagship)

| token | value | note |
|---|---|---|
| `--background` | `240 6% 4%` | near-black, cool |
| `--foreground` | `60 8% 96%` | warm-white |
| `--card` | `240 5% 7%` | |
| `--card-foreground` | `60 8% 96%` | |
| `--popover` / `--popover-foreground` | `240 5% 9%` / `60 8% 96%` | |
| `--primary` | `59 98% 51%` | **electric yellow #FCEE0A** |
| `--primary-foreground` | `60 9% 6%` | near-black on yellow |
| `--primary-text` | `59 98% 51%` | text-grade yellow (added after audit W2-B2: dark reuses the fill value, 17.5:1) |
| `--secondary` / `--secondary-foreground` | `240 4% 13%` / `60 8% 92%` | |
| `--muted` / `--muted-foreground` | `240 4% 12%` / `60 4% 62%` | |
| `--accent` | `59 60% 12%` | dim yellow wash (hover/active) |
| `--accent-foreground` | `59 90% 70%` | |
| `--destructive` / `--destructive-foreground` | `0 85% 55%` / `0 0% 98%` | |
| `--border` / `--input` | `240 4% 15%` | |
| `--border-strong` | `240 4% 26%` | |
| `--ring` | `59 98% 51%` | yellow focus ring |
| `--status-positive` | `152 70% 55%` | neon green |
| `--status-caution` | `45 90% 58%` | amber |
| `--status-info` | `190 90% 60%` | cyan |
| `--chart-1..5` | `59 95% 58%` · `187 95% 55%` · `325 90% 62%` · `152 70% 55%` · `262 85% 68%` | yellow · cyan · magenta · green · violet |
| `--chart-grid` | `240 4% 14%` | |
| `--chart-background` / `--chart-foreground` | = background / foreground | |
| `--neon-cyan` (new) | `187 95% 55%` | replaces `--imperial` usages |
| `--neon-magenta` (new) | `325 90% 62%` | replaces `--pompeian` usages |
| `--radius` | `0.25rem` | sharp corners |

### `:root` (light — "daylight industrial")

| token | value | note |
|---|---|---|
| `--background` | `60 20% 97%` | warm paper |
| `--foreground` | `240 6% 8%` | |
| `--card` / `--card-foreground` | `0 0% 100%` / `240 6% 8%` | |
| `--popover` / `--popover-foreground` | `0 0% 100%` / `240 6% 8%` | |
| `--primary` | `59 95% 42%` | deeper yellow for on-white FILLS (always paired with near-black `--primary-foreground`) |
| `--primary-foreground` | `60 9% 6%` | |
| `--primary-text` | `59 90% 24%` | text-grade yellow — audit W2-B2 measured L42 yellow-on-paper at 1.59:1, so all yellow-as-text uses this token (≥4.5:1) |
| `--secondary` / `--secondary-foreground` | `60 12% 92%` / `240 6% 10%` | |
| `--muted` / `--muted-foreground` | `60 12% 91%` / `240 4% 38%` | |
| `--accent` / `--accent-foreground` | `59 80% 88%` / `60 9% 10%` | pale yellow wash |
| `--destructive` | `0 74% 46%` | |
| `--border` / `--input` | `45 8% 82%` | |
| `--border-strong` | `240 4% 55%` | |
| `--ring` | `59 95% 42%` | |
| `--status-positive` | `152 75% 28%` | text-grade (4.5:1 on white) |
| `--status-caution` | `38 92% 34%` | |
| `--status-info` | `192 90% 30%` | |
| `--chart-1..5` | `59 92% 30%` · `192 92% 30%` · `325 85% 38%` · `152 78% 26%` · `262 68% 42%` | deepened for on-white contrast (chart values double as some data text). NOTE 2026-09-12: direction deltas (ChangeValue up/down) moved to `--status-positive`/`--destructive` — semantic, not chart hues |
| `--chart-grid` | `60 8% 86%` | |
| `--neon-cyan` / `--neon-magenta` | `192 92% 30%` / `325 85% 38%` | |
| `--radius` | `0.25rem` | |

Delete `--imperial`/`--pompeian` and repoint their three known usages (home
eyebrow chip, TvT tokenized-column underline, bento arrow hover) to
`--primary` / `--neon-cyan`. Chart benchmark stays `--muted-foreground`
dashed — never a chart hue.

## 3. Typography (`app/app/layout.tsx` + globals utilities)

- **Display: `Chakra Petch`** (weights 500/600/700) → `--font-display`
  (replaces Cinzel). Squared techno face — the cyberpunk spine. Wordmark,
  page/section headings, stat numerals in heroes.
- **Body: `Geist`** stays (`--font-sans`).
- **Mono: `Geist Mono`** stays (`--font-mono`) — prices, tickers, table data,
  and ALL uppercase micro-labels.
- Update the three utilities in `globals.css`:
  - `.font-display` → `var(--font-display)` (Chakra Petch), letter-spacing 0.01em
  - `.text-display` → Chakra Petch, weight 600, letter-spacing 0.06em
  - `.section-label` → **mono** (Geist Mono), uppercase, 0.7rem, letter-spacing
    0.22em, muted-foreground — terminal eyebrow style. (Add `text-transform:
    uppercase;`.)
- New signature utilities (same `@layer utilities` block):
  - `.glow-primary` → `box-shadow: 0 0 24px hsl(var(--primary) / 0.18)`
  - `.text-glow` → `text-shadow: 0 0 14px hsl(var(--primary) / 0.45)`
  - `.bg-grid` → faint 24px engineering grid via two `linear-gradient`s of
    `hsl(var(--border) / 0.35)` 1px lines (background-image only)
  - `.hairline-primary` → `box-shadow: inset 0 1px 0 hsl(var(--primary) / 0.5)`
    (card top edge accent — use sparingly: heroes/featured cards only)
- Rules: uppercase+tracked labels use mono; never put Chakra Petch on body
  text; prices/tickers/numbers always mono.

## 4. Component rules (all agents)

- Yellow is for: primary buttons (yellow bg, near-black text), focus rings,
  active nav state, key CTAs, hero accents, positive-if-already-yellow data.
  NOT for body text, borders-everywhere, or backgrounds beyond the accent wash.
- Cyan/magenta/green/violet appear ONLY as chart series, delta colors
  (green/red stay semantic), avatar identicons, and small data badges.
- Corners: sharp (`--radius 0.25rem`) — remove bespoke `rounded-full`/`rounded-2xl`
  on cards/buttons/pills where it fights the system (avatar circles stay).
- Shadows: no soft drop shadows on dark; use `.hairline-primary`/`.glow-primary`
  sparingly (hero + primary CTA + featured card only).
- Motion: keep existing motion lib usage; nothing new, no glitch/scanline
  animation effects.
- Contrast: text on yellow must be near-black; text-grade colors must clear
  4.5:1 on their canvas (light-mode chart values above are pre-checked).
- Never describe baskets as ETFs in UI copy (standing AGENTS §10 ban).

## 5. File ownership (no overlaps — ask, don't touch others' paths)

| owner | paths |
|---|---|
| A foundation | `app/app/globals.css`, `app/tailwind.config.js`, `app/app/layout.tsx`, `app/components/ui/**`, `app/components/shell/**`, `app/components/states/**`, `app/components/feedback/**`, `app/components/shimmering-text.tsx` |
| B core pages | `app/app/page.tsx`, `app/components/home/**`, `app/app/stocks/**`, `app/app/stock/[pubkey]`/`[ticker]`/**, `app/components/stocks/**`, `app/app/etfs/**`, `app/components/etfs/**`, `app/app/explore/**`, `app/app/market/**`, `app/app/legal/**`, `app/app/providers/**` |
| C trade surfaces | `app/app/create/**`, `app/components/create/**`, `app/app/basket/**`, `app/components/basket/**`, `app/app/portfolio/**` |
| D social + charts | `app/app/feed/**`, `app/app/leaderboard/**`, `app/app/creator/**`, `app/components/social/**`, `app/components/charts/**` |

B/C/D restyle via className edits and consume A's tokens/utilities; they do
NOT edit `ui/**`/shell — if a primitive needs a new variant, report it
instead. `lib/format.ts` and all `lib/**`, `backend/**` are off-limits.

## 6. Verification

Wave 2 (lead): `npx tsc --noEmit` + `npm run build` in `app/`, grep audits
(no leftover Cinzel-only tracking hacks, no imperial/pompeian references,
yellow-contrast spot checks), then commit on this branch.

## 7. Amendment — de-Rome pass (2026-09-12, owner: "roma işinden çıkıyoruz")

The laurel-wreath / Pantheon / roman-numeral identity is retired on this branch.
Replacement set — "FOUNDRY MARK" + terminal motifs:

**FOUNDRY MARK (the new logo).** A hexagon outline containing three
descending horizontal bars — reads as "index weights in a container" and
abstractly as an angular F. Geometry (viewBox `0 0 24 24`, stroke
`currentColor` unless noted, sharp miter joins):

- Hexagon outline: `M12 2.5 L20.2 7.25 V16.75 L12 21.5 L3.8 16.75 V7.25 Z`
  (stroke-width 1.7, fill none).
- Bars (FILLED rects, no stroke): y=8.1 h=2.1 x=8→16.6; y=11.95 h=2.1
  x=8→14.6; y=15.8 h=2.1 x=8→12.6 (descending widths = weights).
- Header wordmark: mark + "Basalt" text where the **X renders in
  `text-primary`** (yellow accent); rest stays foreground.
- Favicon (`icon.svg`): same geometry, yellow #FCEE0A strokes/bars on a
  near-black #0A0A0B square (sharpen rx to 4).
- `apple-icon.tsx` + `opengraph-image.tsx`: same mark scaled up, identical
  colors (no laurel geometry anywhere).

**Motif replacements:**
- Home flow steps: column/coin/laurel line-art → (01) stacked weight-bars
  with square knobs (echoes the weights editor), (02) hexagon + center plus
  (mint a share), (03) arrow exiting a bracket (redeem out). Numerals
  I/II/III and I–VI → zero-padded mono `01`–`06` (terminal style).
- Hero chip laurel glyphs → mono `//` decorations in text-primary.
- Pantheon engraving watermark → inline-SVG "circuit blueprint": concentric
  hexagon outlines + node dots + straight connector traces, white at
  opacity ≤0.07, same placement. No photos, no engravings.
- `profile-editor` handle placeholder "Aurelius" → "satoshi".
- `public/brand`: delete pantheon-engraving.jpg + roman-1..6.jpg once
  unreferenced (grep first); keep market-hero.png only if still referenced.
- brand.md: update Roman voice/identity references to NEON FOUNDRY (minimal edit).
- All touched docstrings/comments drop roman/laurel phrasing (historical
  branch names in git/docs stay as-is).

## 8. Amendment — home refresh (2026-09-12, "proof beats process")

The home page reorders around evidence: directly after the hero, a new
`LiveProofSection` (two silently-polled columns — latest verified trades
from the feed and all-time top baskets from the leaderboard, 60s
visibility-gated, honest empty/error states, nothing fabricated) precedes
any process talk; the Flow section relabels to **CREATE · MINT · SHARE**
with step 03 now a terminal-prompt motif routing to the leaderboard
(superseding §7's "arrow exiting a bracket" redeem-out motif); the Ledger
comparison (SAME EXPOSURE. DIFFERENT RAILS.) widens from max-w-3xl to the
site-wide max-w-6xl rhythm (spine cell 12rem, text-sm rails — the "her şey
ortalanmış" alignment fix); and the closing navigation strip is retired,
replaced by `IntentCards` — four hairline-divided route-by-intent links
(Browse baskets / Follow top traders / Open the feed / Build your own)
carrying the shared lifting-↗ footer language.

## 9. Amendment — friendly preview pass (2026-09-12)

The §8 live-proof band is softened per owner feedback ("same honest data,
warmer presentation — a marketing surface, not a terminal"): the trades
column reads as single-sentence rows ("a trader bought 12.5 shares of …")
with semantic color reduced to positive-green on "bought" only — no red
anywhere on the home surface, no SideBadge chips; Minted/Redeemed semantics
and their red styling stay inside `/feed`. The baskets column adopts an
adaptive window cascade (30d → 7d → all-time; the first window with rows
wins) so a quiet devnet board never leads with an empty column or the
absurd all-time mock deltas, and the header labels whichever window was
actually used. `ActorLine` grows an opt-in `friendlyFallback` prop —
anonymous wallets render as "a trader" instead of truncated pubkeys (the
address stays on the `title` attribute; every existing caller is
unchanged). Three rows per column throughout.

## 10. Amendment — demo overlay extended to /feed and /leaderboard (2026-09-12)

The `NEXT_PUBLIC_HOME_DEMO=1` demo overlay (introduced on the home
live-proof band) now also gates `/feed` and `/leaderboard`, all reading the
one shared helper `lib/demo-mode.ts` (`isDemoMode()`). Demo mode makes zero
network calls — no fetches, no polling, no auth prompts, no write
endpoints — and every demo surface is labeled with the mono "demo data"
chip so the synthetic datasets can never masquerade as live activity. Demo
theses carry stringified negative ids ("-1".."-5") that can never collide
with real post ids, so demo rows can never act on (or be mistaken for) a
real post. On home, the live-proof band keeps a balanced 3/3 row count —
both columns slice to `VISIBLE_ROW_COUNT = 3` so neither leads with a
lopsided board. Flag off = the real fetch/poll path, byte-identical.
