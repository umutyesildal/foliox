import Link from "next/link";

import { SectionHeader } from "@/components/ui/section-header";

/**
 * Flow section — replaces the old bento gateway. One idea: every basket
 * follows the same three steps, shown as three bare inscription columns —
 * no card chrome (owner feedback 2026-09-03: kill the boxes), just a
 * line-drawn motif, a small quiet mono numeral, and two lines of
 * copy. Columns are separated by hairline verticals on desktop only. The
 * motif brightens muted→foreground on hover (≤200ms, reduced-motion
 * honored); the numeral stays still. No color — line art only, all
 * strokes currentColor.
 */

/** I. CREATE — a classical column: abacus, echinus capital, fluted shaft,
 *  molded base, plinth. The act of composing the basket. */
function ColumnMotif() {
  return (
    <svg
      aria-hidden="true"
      width={64}
      height={64}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-16 w-16 text-muted-foreground/80 transition-colors duration-200 group-hover:text-foreground"
    >
      <path d="M15 9h34M17 13h30" />
      <path d="M19 13c0 3.5 3 5.5 6 5.5h14c3 0 6-2 6-5.5" />
      {/* shaft + two flutes */}
      <path d="M24.5 18.5v27.5M39.5 18.5v27.5" />
      <path d="M30 21v23M34 21v23" />
      {/* base flare, die, plinth, ground */}
      <path d="M24.5 46c0 2.5-2 3.2-4.5 3.5h24c-2.5-.3-4.5-1-4.5-3.5" />
      <path d="M18 53h28M14.5 56.5h35" />
    </svg>
  );
}

/** II. MINT — a coin: double circle with a reeded rim (radial ticks sit on
 *  the outer edge, like milling on a struck denarius). Kept abstract — no
 *  lettering. The act of deposit and issue. */
function CoinMotif() {
  return (
    <svg
      aria-hidden="true"
      width={64}
      height={64}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-16 w-16 text-muted-foreground/80 transition-colors duration-200 group-hover:text-foreground"
    >
      <circle cx={32} cy={32} r={20} />
      <circle cx={32} cy={32} r={13} />
      <circle cx={32} cy={32} r={1.8} />
      {/* reeded rim: twelve radial ticks seated on the outer edge */}
      <path d="M52 32h3.5M12 32h-3.5M32 52v3.5M32 12v-3.5" />
      <path d="M49.3 42l3 1.8M14.7 42l-3 1.8M49.3 22l3-1.8M14.7 22l-3-1.8" />
      <path d="M42 49.3l1.8 3M22 49.3l-1.8 3M42 14.7l1.8-3M22 14.7l-1.8-3" />
    </svg>
  );
}

/** III. REDEEM — a laurel branch: one curved stem, five leaves in alternating
 *  pairs and a terminal leaf. The honor received on withdrawal. */
function LaurelBranchMotif() {
  return (
    <svg
      aria-hidden="true"
      width={64}
      height={64}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-16 w-16 text-muted-foreground/80 transition-colors duration-200 group-hover:text-foreground"
    >
      {/* stem, sweeping from base to tip */}
      <path d="M12 54C24 47 36 34 52 14" />
      {/* leaves — full almond lenses, alternating below/above the stem */}
      <path d="M19.2 49.1Q24.5 54.3 28.5 50.5Q23.2 45.3 19.2 49.1Z" />
      <path d="M26.7 42.7Q33.2 40.2 31.5 33.5Q25 36 26.7 42.7Z" />
      <path d="M34.5 34.7Q38.1 40.1 43.5 36.5Q39.9 31.1 34.5 34.7Z" />
      <path d="M42.8 25.2Q49.2 23 47.5 16.5Q41.1 18.7 42.8 25.2Z" />
      {/* terminal leaf */}
      <path d="M52 14Q58.2 12.3 57 6Q50.8 7.7 52 14Z" />
    </svg>
  );
}

const STEPS = [
  {
    numeral: "I",
    copy: "Pick the stocks, set the weights. Immutable after deployment.",
    href: "/create",
    Motif: ColumnMotif,
  },
  {
    numeral: "II",
    copy: "Deposit tokens, receive basket tokens at the exact weights.",
    href: "/explore",
    Motif: CoinMotif,
  },
  {
    numeral: "III",
    copy: "Burn tokens, receive the underlying. Wallet to wallet.",
    href: "/portfolio",
    Motif: LaurelBranchMotif,
  },
] as const;

export function FlowSection() {
  return (
    <section
      aria-labelledby="flow-heading"
      className="border-t border-border py-16 dark:border-border/60"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* Section header — tracked mono eyebrow + the one line. */}
        <SectionHeader
          id="flow-heading"
          label="CREATE · MINT · REDEEM"
          lead="Every basket follows the same three steps."
        />

        <ol className="mt-12 grid grid-cols-1 gap-y-12 sm:grid-cols-3">
          {STEPS.map((step) => (
            <li
              key={step.numeral}
              className="border-border/50 sm:border-l sm:pl-10 sm:first:border-l-0 sm:first:pl-0 dark:border-border/40"
            >
              <Link
                href={step.href}
                className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {/* Motif — bare, no frame; inks up on hover. */}
                <step.Motif />
                {/* Numeral — a whisper, not a headline. */}
                <span
                  aria-hidden="true"
                  className="mt-4 block font-mono text-sm font-medium leading-none tracking-[0.22em] text-muted-foreground/70"
                >
                  {step.numeral}
                </span>
                <span className="mt-3 block max-w-xs text-sm leading-5 text-muted-foreground">
                  {step.copy}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
