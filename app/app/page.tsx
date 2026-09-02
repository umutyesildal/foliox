import Link from "next/link";

/**
 * Landing — classic shadcn-style hero (monochrome simplification, 2026-09-02):
 * a badge line, h1, one subline, two CTAs, then one quiet Create → Mint →
 * Redeem row and the footer. No texture, stats, devices, or data fetch —
 * details live on the other pages.
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
    </div>
  );
}
