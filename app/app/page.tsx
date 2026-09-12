import Link from "next/link";

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
 * — before any process talk. The three-step flow merged INTO the
 * live-proof section (2026-09-12): its StepsStrip — now PICK · OWN ·
 * SHARE, user-outcome verbs instead of program operations (owner: the
 * product being sold isn't mint itself) — renders below the proof grid.
 * Then the Ledger rails comparison (traditional vs tokenized), and
 * the IntentCards gateway (which absorbs the deleted closing navigation
 * strip). No footer, no photography. `.bg-grid` appears on the hero
 * section only — one grid per page.
 */
export default function LandingPage() {
  return (
    <div className="mx-auto w-full">
      <section className="bg-grid relative w-full overflow-hidden">
        {/* Watermark — inline-SVG "causeway blueprint" (BASALT,
            2026-09-12). A honeycomb tessellation of seven hexagon outlines
            — basalt columns seen top-down (design-basalt-v1 §4) — with
            square node dots seated on the cell centers and straight
            connector traces between them, all stroked white at 7% opacity
            over the near-black canvas. Pushed low (top 62%) so the lower
            cells emerge below the CTA cluster, and a heavy top fade keeps
            the headline zone pure background — the causeway is revealed
            progressively downward. A soft radial scrim behind the text
            block guarantees contrast. */}
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
            {/* causeway tessellation — seven pointy-top hexagon cells,
                edge-adjacent (columns seen top-down) */}
            <path d="M300 232 L241.1 266 L241.1 334 L300 368 L358.9 334 L358.9 266 Z" />
            <path d="M417.8 232 L358.9 266 L358.9 334 L417.8 368 L476.7 334 L476.7 266 Z" />
            <path d="M358.9 130 L300 164 L300 232 L358.9 266 L417.8 232 L417.8 164 Z" />
            <path d="M241.1 130 L182.2 164 L182.2 232 L241.1 266 L300 232 L300 164 Z" />
            <path d="M182.2 232 L123.3 266 L123.3 334 L182.2 368 L241.1 334 L241.1 266 Z" />
            <path d="M241.1 334 L182.2 368 L182.2 436 L241.1 470 L300 436 L300 368 Z" />
            <path d="M358.9 334 L300 368 L300 436 L358.9 470 L417.8 436 L417.8 368 Z" />
            {/* straight connector traces between cell centers */}
            <line x1="300" y1="300" x2="417.8" y2="300" />
            <line x1="300" y1="300" x2="241.1" y2="402" />
            <line x1="241.1" y1="198" x2="358.9" y2="402" />
            <line x1="358.9" y1="198" x2="241.1" y2="402" />
            {/* square node dots seated on the cell centers */}
            <rect x="294" y="294" width="12" height="12" />
            <rect x="411.8" y="294" width="12" height="12" />
            <rect x="352.9" y="192" width="12" height="12" />
            <rect x="235.1" y="192" width="12" height="12" />
            <rect x="176.2" y="294" width="12" height="12" />
            <rect x="235.1" y="396" width="12" height="12" />
            <rect x="352.9" y="396" width="12" height="12" />
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

      {/* Live proof + steps — real trades and real returns from the social
          API, before any process talk ("proof beats process", NEON FOUNDRY
          2026-09-12). The PICK · OWN · SHARE steps strip lives inside this
          section, below its grid (merged 2026-09-12; replaces the old
          standalone Flow section). */}
      <LiveProofSection />

      {/* Ledger — same exposure, different rails. No card, no cell borders. */}
      <LedgerSection />

      {/* Intent cards — the closing gateway; the old asset-class strip became
          intent routing (browse / follow / feed / build), NEON FOUNDRY 2026-09-12. */}
      <IntentCards />
    </div>
  );
}
