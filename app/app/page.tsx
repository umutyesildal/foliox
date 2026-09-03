import Link from "next/link";

import { RomanHeroBand } from "@/components/home/roman-hero-band";
import { FlowSection } from "@/components/home/flow-section";
import { LedgerSection } from "@/components/home/ledger-section";
import { ClosingStrip } from "@/components/home/closing-strip";

/*
 * Imagery attribution (roman-empire):
 *   public/brand/roman-2.jpg — Pantheon dome interior photo by T. Le Berre,
 *   CC BY-SA 4.0. Source and license: docs/roman-imagery-sources.md. An
 *   on-image credit also renders bottom-right of the hero band.
 */

/** Small laurel-wreath glyph — two mirrored branches with leaf ticks, drawn
 *  as plain strokes so it inherits color. Decorative only (aria-hidden). */
function LaurelGlyph({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      className="shrink-0 opacity-80"
    >
      {/* two branches rising from a shared base */}
      <path d="M8 14.4C5.1 13.4 3.2 10.8 3.2 7.5c0-1.7.5-3.3 1.4-4.7" />
      <path d="M8 14.4c2.9-1 4.8-3.6 4.8-6.9 0-1.7-.5-3.3-1.4-4.7" />
      {/* left-branch leaves */}
      <path d="M4.1 6.7 2.5 6.1M4.6 9.9 2.9 10.2M5.8 12.4l-1.4 1" />
      {/* right-branch leaves */}
      <path d="m11.9 6.7 1.6-.6M11.4 9.9l1.7.3M10.2 12.4l1.4 1" />
    </svg>
  );
}

/**
 * Landing — classic shadcn-style hero (monochrome simplification, 2026-09-02;
 * roman-empire redesign, 2026-09-03): laurel chip, Cinzel headline, one
 * subline, two CTAs — then a full-bleed cinematic Pantheon band melting into
 * the page, the three-step Flow section (real screen crops), the Ledger
 * inscription (traditional vs tokenized rails), and a closing navigation
 * strip fed by the live xStocks registry. No footer.
 */
export default function LandingPage() {
  return (
    <div className="mx-auto w-full">
      <section className="mx-auto flex max-w-3xl flex-col items-center px-4 pb-20 pt-24 text-center sm:px-6 md:pt-32">
        <p className="inline-flex items-center gap-2.5 rounded-full border border-[hsl(var(--imperial)/0.45)] bg-muted/40 px-3.5 py-1 font-mono text-xs tracking-wide text-[hsl(var(--imperial))]">
          <LaurelGlyph />
          Onchain strategy baskets · xStocks
          <LaurelGlyph flip />
        </p>
        <h1 className="mt-6 font-[family-name:var(--font-display)] text-balance text-6xl font-semibold leading-[1.08] tracking-normal md:text-7xl">
          Create an index. Own your thesis.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          Tokenized baskets of xStocks — immutable weights, capped fees,
          permissionless redemption.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/create"
            className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
      </section>

      {/* Cinematic band — the Pantheon dome interior, edge to edge, bottom
          fade into the page. Punctuation, not content: no headline on it. */}
      <RomanHeroBand />

      {/* Flow — the three steps every basket follows, as inscription columns. */}
      <FlowSection />

      {/* Ledger — same exposure, different rails. No card, no cell borders. */}
      <LedgerSection />

      {/* Closing strip — navigation role of the deleted bento, one hairline
          row fed by the live xStocks registry. */}
      <ClosingStrip />
    </div>
  );
}
