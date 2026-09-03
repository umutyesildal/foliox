import Image from "next/image";
import Link from "next/link";

import { TraditionalVsTokenized } from "@/components/etfs/traditional-vs-tokenized";

/**
 * Hero product visual — a real product screenshot. To swap it later, replace
 * the file at app/public/brand/market-hero.png (keep the path) or edit this
 * single constant: src / alt / width / height. Recommended export: 1600×900
 * (16:9) PNG, monochrome UI screenshot. Update the alt text to describe the
 * new image honestly.
 */
const HERO_IMAGE = {
  src: "/brand/market-hero.png",
  alt: "FolioX Market page — live Nasdaq benchmarks normalized to 100",
  width: 1600,
  height: 900,
} as const;

/** Which monochrome visual anchor a gateway card carries (see SectionAnchor). */
type SectionAnchorKind = "stocks" | "etfs" | "baskets";

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
 * Section gateway — the three main areas of the product, as a bento grid of
 * cards. Each card: roman-numeral index (I/II/III, display face), a small
 * pure-CSS anchor (ticker rows or a weight bar — typography only, no icons,
 * no color), name, one short line, and a ↗ that lifts on hover with a
 * single pompeian-red accent. Details live on the pages themselves.
 */
const SECTIONS: {
  index: string;
  name: string;
  line: string;
  href: string;
  anchor: SectionAnchorKind;
}[] = [
  {
    index: "I",
    name: "Stocks",
    line: "Tokenized stocks across providers.",
    href: "/stocks",
    anchor: "stocks",
  },
  {
    index: "II",
    name: "Tokenized ETFs",
    line: "The tokenized ETF tickers FolioX lists today.",
    href: "/etfs",
    anchor: "etfs",
  },
  {
    index: "III",
    name: "Baskets",
    line: "Community-made baskets, benchmarked on-chain.",
    href: "/explore",
    anchor: "baskets",
  },
];

/** Decorative per-card anchor — ticker hairline rows for Stocks/ETFs, a mini
 *  weight-bar stack for Baskets. Monochrome, aria-hidden, no meaning. */
function SectionAnchor({ kind }: { kind: SectionAnchorKind }) {
  if (kind === "baskets") {
    return (
      <div aria-hidden="true" className="space-y-1.5">
        <div className="h-1 w-full rounded-full bg-foreground/70" />
        <div className="h-1 w-3/5 rounded-full bg-foreground/40" />
        <div className="h-1 w-1/3 rounded-full bg-foreground/25" />
      </div>
    );
  }
  const rows =
    kind === "stocks"
      ? ([
          ["NVDA", "30%"],
          ["AAPL", "24%"],
          ["TSLA", "16%"],
        ] as const)
      : ([
          ["TECH", "60%"],
          ["CORE", "40%"],
        ] as const);
  return (
    <div aria-hidden="true" className="space-y-1.5">
      {rows.map(([ticker, weight]) => (
        <div
          key={ticker}
          className="flex items-center gap-2 font-mono text-[10px] leading-none"
        >
          <span className="w-10 text-foreground/70">{ticker}</span>
          <span className="h-px flex-1 bg-border" />
          <span className="text-muted-foreground">{weight}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Landing — classic shadcn-style hero (monochrome simplification, 2026-09-02,
 * elevated 2026-09-03): a badge line, big h1, one subline, two CTAs, then the
 * real product visual on an elevated card that overlaps a barely-there radial
 * vignette, the interactive Traditional vs tokenized comparison (moved here
 * from /etfs), and a three-card bento gateway (Stocks / Tokenized ETFs /
 * Baskets). No footer, texture, stats, devices, or data fetch.
 */
export default function LandingPage() {
  return (
    <div className="mx-auto w-full">
      <section className="mx-auto flex max-w-3xl flex-col items-center px-4 pb-24 pt-24 text-center sm:px-6 md:pt-32">
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

      {/* Real product visual — elevated screenshot card sitting on a subtle
          monochrome radial vignette (pure CSS, foreground at 4%). */}
      <section
        aria-label="Product preview"
        className="relative mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[-2rem] h-[26rem] w-[min(92%,44rem)] -translate-x-1/2 bg-[radial-gradient(closest-side,hsl(var(--foreground)/0.04),transparent)]"
        />
        <div className="relative -mt-8 rounded-xl bg-card p-2 shadow-sm ring-1 ring-border dark:shadow-xl dark:shadow-black/20">
          <Image
            src={HERO_IMAGE.src}
            alt={HERO_IMAGE.alt}
            width={HERO_IMAGE.width}
            height={HERO_IMAGE.height}
            priority
            className="h-auto w-full rounded-lg"
          />
        </div>
        <p className="mt-3 text-center font-mono text-[11px] text-muted-foreground">
          Live market view · Yahoo Finance · as-of labeled
        </p>
      </section>

      {/* Traditional vs tokenized — interactive comparison (moved from /etfs),
          its own quiet section between the hero visual and the gateway. */}
      <section
        aria-label="Traditional vs tokenized ETFs"
        className="border-t border-border py-16 dark:border-border/60"
      >
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <p className="font-[family-name:var(--font-display)] text-sm uppercase tracking-[0.12em] text-muted-foreground">
            Traditional vs tokenized
          </p>
          <p className="mt-3 max-w-2xl text-balance text-base leading-7 text-muted-foreground">
            The same underlying ETF, wrapped differently.
          </p>
          <div className="mt-8">
            <TraditionalVsTokenized />
          </div>
        </div>
      </section>

      {/* Section gateway — three bento cards, full-width of the container. */}
      <section
        aria-label="Explore FolioX"
        className="border-t border-border py-16 dark:border-border/60"
      >
        <nav aria-label="Sections" className="mx-auto max-w-5xl px-4 sm:px-6">
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className="group flex min-h-36 flex-col justify-between gap-6 rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <div className="flex items-center justify-between">
                    <span
                      aria-hidden="true"
                      className="font-[family-name:var(--font-display)] text-xs font-medium tracking-[0.08em] text-muted-foreground"
                    >
                      {section.index}
                    </span>
                    <span
                      aria-hidden="true"
                      className="font-mono text-sm text-muted-foreground transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[hsl(var(--pompeian))]"
                    >
                      ↗
                    </span>
                  </div>
                  <SectionAnchor kind={section.anchor} />
                  <div>
                    <p className="text-lg font-medium leading-tight text-foreground">
                      {section.name}
                    </p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      {section.line}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
    </div>
  );
}
