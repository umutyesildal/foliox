import Link from "next/link";

import { SectionHeader } from "@/components/ui/section-header";

/**
 * Intent cards — replace the deleted asset-class gateway with a
 * route-by-intent row (route-by-intent research; Jupiter verb taxonomy:
 * browse / follow / read / build). Four full-surface links, hairline-
 * divided like the closing strip they absorb — no card chrome, label +
 * one line + a lifting ↗. Social surfaces (leaderboard, feed) are
 * surfaced beside research and create so every way in is one click from
 * the home page. Owner feedback 2026-09-12.
 */

const CARDS = [
  { label: "Browse baskets", line: "Weighted, on-chain, live", href: "/explore" },
  { label: "Follow top traders", line: "Estimated ROI, real wallets", href: "/leaderboard" },
  { label: "Open the feed", line: "Every trade, verified on-chain", href: "/feed" },
  { label: "Build your own", line: "Pick the stocks, set the weights", href: "/create" },
] as const;

export function IntentCards() {
  return (
    <section
      aria-label="Start where you like"
      className="border-t border-border pt-16 dark:border-border/60"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section header — tracked mono eyebrow + the one line. */}
        <SectionHeader
          size="eyebrow"
          label="START WHERE YOU LIKE"
          lead="Four ways in — all of them non-custodial."
        />

        <div className="mt-12 grid grid-cols-1 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group flex items-center justify-between gap-4 py-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:flex-col sm:items-start sm:justify-start sm:gap-3 sm:px-6 sm:first:pl-0 sm:last:pr-0"
            >
              <span className="section-label">{card.label}</span>
              <span className="text-sm leading-5 text-foreground">
                {card.line}
              </span>
              <span
                aria-hidden="true"
                className="font-mono text-sm text-muted-foreground transition-all duration-200 group-hover:-translate-y-0.5 group-hover:text-primary-text motion-reduce:transform-none motion-reduce:transition-none"
              >
                ↗
              </span>
            </Link>
          ))}
        </div>
        <div className="pb-8" />
      </div>
    </section>
  );
}
