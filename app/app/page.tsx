import Link from "next/link";

import { FlowSection } from "@/components/home/flow-section";
import { LedgerSection } from "@/components/home/ledger-section";
import { LiveProofSection } from "@/components/home/live-proof-section";
import { IntentCards } from "@/components/home/intent-cards";

/**
 * Landing — NEON FOUNDRY hero (cyberpunk-yellow restyle, 2026-09-12; was the
 * roman-empire redesign of 2026-09-03): yellow mono chip flanked by mono
 * `//` terminal decorations, Chakra Petch headline with a soft primary
 * glow, one subline, two CTAs — over a faint engineering grid, with an
 * inline-SVG "circuit blueprint" (concentric hexagons, node squares,
 * straight connector traces) ghosted BEHIND the hero copy as a
 * barely-visible watermark.
 *
 * "Proof beats process" reorder (NEON FOUNDRY, 2026-09-12): the hero's
 * subline now points at the traders, and the very next thing on the page
 * is LIVE PROOF — the LiveProofSection's two polled columns (latest
 * verified trades + all-time top baskets, straight from the social API)
 * — before any process talk. Then the three-step Flow section (drawn
 * motifs), the Ledger rails comparison (traditional vs tokenized), and
 * the IntentCards gateway (which absorbs the deleted closing navigation
 * strip). No footer, no photography. `.bg-grid` appears on the hero
 * section only — one grid per page.
 */
export default function LandingPage() {
  return (
    <div className="mx-auto w-full">
      <section className="bg-grid relative w-full overflow-hidden">
        {/* Watermark — inline-SVG "circuit blueprint" (NEON FOUNDRY,
            2026-09-12). Three concentric hexagon outlines (the spec §7
            FOUNDRY MARK hexagon, scaled), eight small square node dots and
            straight connector traces between them — all stroked white at
            7% opacity over the near-black canvas. Pushed low (top 62%) so
            the lower hexagon edge emerges below the CTA cluster, and a
            heavy top fade keeps the headline zone pure background — the
            blueprint is revealed progressively downward. A soft radial
            scrim behind the text block guarantees contrast. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <svg
            aria-hidden="true"
            viewBox="0 0 600 600"
            fill="none"
            stroke="white"
            strokeWidth={2}
            preserveAspectRatio="xMidYMid slice"
            className="absolute left-1/2 top-[62%] w-[94%] max-w-[1100px] -translate-x-1/2 -translate-y-1/2 select-none opacity-[0.07]"
          >
            {/* concentric hexagon outlines (spec §7 FOUNDRY MARK shape, scaled) */}
            <path d="M300 62.5 L505 181.25 V418.75 L300 537.5 L95 418.75 V181.25 Z" />
            <path d="M300 138.5 L439.4 219.25 V380.75 L300 461.5 L160.6 380.75 V219.25 Z" />
            <path d="M300 209.75 L377.9 254.88 V345.13 L300 390.25 L222.1 345.13 V254.88 Z" />
            {/* straight connector traces between nodes */}
            <line x1="300" y1="62.5" x2="300" y2="390.25" />
            <line x1="505" y1="181.25" x2="160.6" y2="219.25" />
            <line x1="95" y1="418.75" x2="377.9" y2="254.88" />
            <line x1="439.4" y1="380.75" x2="300" y2="537.5" />
            {/* square node dots seated on vertices / trace endpoints */}
            <rect x="294" y="56.5" width="12" height="12" />
            <rect x="499" y="175.25" width="12" height="12" />
            <rect x="89" y="412.75" width="12" height="12" />
            <rect x="294" y="531.5" width="12" height="12" />
            <rect x="154.6" y="213.25" width="12" height="12" />
            <rect x="433.4" y="374.75" width="12" height="12" />
            <rect x="371.9" y="248.88" width="12" height="12" />
            <rect x="294" y="384.25" width="12" height="12" />
          </svg>
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,hsl(var(--background))_0%,hsl(var(--background))_36%,transparent_64%,transparent_74%,hsl(var(--background))_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--background))_0%,transparent_18%,transparent_82%,hsl(var(--background))_100%)]" />
          {/* Text-zone scrim — blurred-edge radial behind eyebrow + headline
              + CTAs only; invisible at the edges, /55 at the core. */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_62%_48%_at_50%_34%,hsl(var(--background)/0.55)_0%,hsl(var(--background)/0.3)_55%,transparent_78%)]" />
        </div>
        <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-4 pb-20 pt-24 text-center sm:px-6 md:pt-32">
          <p className="inline-flex items-center gap-2.5 border border-primary/40 bg-accent/30 px-3.5 py-1 font-mono text-xs tracking-wide text-primary-text">
            <span aria-hidden="true" className="leading-none text-primary">
              //
            </span>
            Onchain strategy baskets · xStocks
            <span aria-hidden="true" className="leading-none text-primary">
              //
            </span>
          </p>
          <h1 className="text-display text-glow mt-6 text-balance text-6xl leading-[1.08] md:text-7xl">
            Create an index. Own your thesis.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
            Tokenized baskets of xStocks — immutable weights, capped fees,
            permissionless redemption. Follow the traders behind them.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/create"
              className="glow-primary inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Create an index
            </Link>
            <Link
              href="/explore"
              className="inline-flex h-10 items-center rounded-lg border border-border bg-transparent px-5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Explore baskets
            </Link>
          </div>
        </div>
      </section>

      {/* Live proof — real trades and real returns from the social API,
          before any process talk ("proof beats process", NEON FOUNDRY
          2026-09-12). */}
      <LiveProofSection />

      {/* Flow — the three steps every basket follows, as drawn terminal
          motifs (NEON FOUNDRY, 2026-09-12). */}
      <FlowSection />

      {/* Ledger — same exposure, different rails. No card, no cell borders. */}
      <LedgerSection />

      {/* Intent cards — the closing gateway; the old asset-class strip became
          intent routing (browse / follow / feed / build), NEON FOUNDRY 2026-09-12. */}
      <IntentCards />
    </div>
  );
}
