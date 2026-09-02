import Image from "next/image";
import Link from "next/link";

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

/**
 * Landing — classic shadcn-style hero (monochrome simplification, 2026-09-02):
 * a badge line, h1, one subline, two CTAs, then the real product visual, one
 * quiet Create → Mint → Redeem row and a single muted disclosure line. No
 * texture, stats, devices, or data fetch — details live on the other pages.
 * The landing deliberately renders no SiteFooter; footers are per-page.
 */
export default function LandingPage() {
  return (
    <div className="mx-auto w-full">
      <section className="mx-auto flex max-w-3xl flex-col items-center px-4 pb-24 pt-24 text-center sm:px-6 md:pt-32">
        <p className="rounded-full border border-border/60 px-3 py-1 font-mono text-xs text-muted-foreground">
          Onchain strategy baskets · xStocks
        </p>
        <h1 className="mt-6 text-5xl font-semibold tracking-tight md:text-6xl">
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

      {/* Real product visual — framed screenshot, captioned with source honesty. */}
      <section
        aria-label="Product preview"
        className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6"
      >
        <Image
          src={HERO_IMAGE.src}
          alt={HERO_IMAGE.alt}
          width={HERO_IMAGE.width}
          height={HERO_IMAGE.height}
          priority
          className="h-auto w-full rounded-lg border border-border/80 ring-1 ring-border"
        />
        <p className="mt-2 text-center font-mono text-[11px] text-muted-foreground">
          Live market view · Yahoo Finance · as-of labeled
        </p>
      </section>

      {/* Single quiet section — three one-liners, no snippets. */}
      <section
        aria-label="How FolioX works"
        className="border-t border-border/60 py-12"
      >
        <ul className="mx-auto grid max-w-3xl gap-3 px-4 font-mono text-sm text-muted-foreground sm:grid-cols-3 sm:px-6">
          <li>
            <span className="text-foreground">Create</span> — pick 2-20 xStocks,
            fix the weights.
          </li>
          <li>
            <span className="text-foreground">Mint</span> — seed the vault in
            one atomic transaction.
          </li>
          <li>
            <span className="text-foreground">Redeem</span> — burn shares for a
            pro-rata payout.
          </li>
        </ul>
      </section>

      {/* Not a footer block — one tiny muted disclosure line. */}
      <p className="mx-auto w-full max-w-3xl px-4 pb-10 text-center text-[11px] text-muted-foreground sm:px-6">
        Not investment advice · xStocks are structured instruments ·{" "}
        <Link
          href="/legal"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Risks &amp; Disclosures
        </Link>
      </p>
    </div>
  );
}
