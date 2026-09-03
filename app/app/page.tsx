import Link from "next/link";

import { FlowSection } from "@/components/home/flow-section";
import { LedgerSection } from "@/components/home/ledger-section";
import { ClosingStrip } from "@/components/home/closing-strip";

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
 * subline, two CTAs — with a public-domain Piranesi engraving of the Pantheon
 * ghosted BEHIND the hero copy as a barely-visible watermark (owner feedback:
 * real drawing, not a framed photo, not the hand-drawn SVG), then the
 * three-step Flow section (drawn Roman motifs), the Ledger inscription
 * (traditional vs tokenized rails), and a closing navigation strip fed by
 * the live xStocks registry. No footer, no photography.
 */
export default function LandingPage() {
  return (
    <div className="mx-auto w-full">
      <section className="relative w-full overflow-hidden">
        {/* Watermark — Francesco Piranesi, "Veduta del Pantheon d'Agrippa"
            (1790, public domain). The plate is dark ink on light paper, so
            `invert` flips it to light lines on dark; at 16% opacity over the
            near-black canvas only the etched strokes survive as a faint
            texture. Gradient masks dissolve every edge into the page. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <img
            src="/brand/pantheon-engraving.jpg"
            alt=""
            className="absolute left-1/2 top-1/2 w-[94%] max-w-[1100px] -translate-x-1/2 -translate-y-1/2 select-none opacity-[0.16] [filter:invert(1)_grayscale(1)_contrast(1.06)]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,hsl(var(--background))_0%,transparent_28%,transparent_70%,hsl(var(--background))_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--background))_0%,transparent_18%,transparent_82%,hsl(var(--background))_100%)]" />
        </div>
        <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-4 pb-20 pt-24 text-center sm:px-6 md:pt-32">
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
        </div>
      </section>

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
