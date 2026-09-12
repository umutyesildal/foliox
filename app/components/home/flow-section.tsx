import Link from "next/link";

import { SectionHeader } from "@/components/ui/section-header";

/**
 * Flow section — replaces the old bento gateway. One idea: every basket
 * follows the same three steps, shown as three bare terminal columns —
 * no card chrome (owner feedback 2026-09-03: kill the boxes), just a
 * line-drawn motif, a small quiet zero-padded mono numeral, and two
 * lines of copy. Columns are separated by hairline verticals on desktop
 * only. The motif brightens muted→foreground on hover (≤200ms,
 * reduced-motion honored); the numeral stays still. No color — line art
 * only, all strokes currentColor. (NEON FOUNDRY de-Rome pass, 2026-09-12.)
 *
 * Social-era refresh (owner feedback, 2026-09-12): the three steps now end
 * in the social layer — step 03 SHARE routes to the leaderboard, not
 * redemption — while discovery itself is carried by the live proof section
 * above this one. Container unified to the site rhythm (max-w-6xl, was 5xl).
 */

/** 01. CREATE — stacked weights: three horizontal bars of descending
 *  width, each carrying a small square knob — echoes the weights editor.
 *  The act of composing the basket. (NEON FOUNDRY, 2026-09-12.) */
function WeightBarsMotif() {
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
      {/* three weight bars, widest to narrowest */}
      <rect x={10} y={15} width={44} height={10} />
      <rect x={10} y={27} width={32} height={10} />
      <rect x={10} y={39} width={20} height={10} />
      {/* one square knob per bar, seated near its right end */}
      <rect x={45} y={16.5} width={7} height={7} />
      <rect x={33} y={28.5} width={7} height={7} />
      <rect x={21} y={40.5} width={7} height={7} />
    </svg>
  );
}

/** 02. MINT — a hexagon outline with a plus sign at its center: a share
 *  minted into the foundry container. The act of deposit and issue.
 *  (NEON FOUNDRY, 2026-09-12.) */
function HexPlusMotif() {
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
      {/* hexagon — the FOUNDRY MARK container (spec §7 shape, scaled) */}
      <path d="M32 11.1 50 21.55V42.45L32 52.9 14 42.45V21.55Z" />
      {/* plus at the center */}
      <path d="M32 26v12M26 32h12" />
    </svg>
  );
}

/** 03. SHARE — a terminal window outline holding a `>` chevron and a
 *  cursor underscore: a thesis enters the record, typed at the prompt for
 *  everyone to read. Echoes the `//` chip language.
 *  (NEON FOUNDRY, 2026-09-12.) */
function PromptMotif() {
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
      {/* terminal window — the record, open and public */}
      <rect x={10} y={16} width={44} height={32} />
      {/* `>` chevron — the prompt awaiting a thesis */}
      <path d="M18 26l6 6-6 6" />
      {/* underscore — the cursor on the line being written */}
      <path d="M30 38h12" />
    </svg>
  );
}

const STEPS = [
  {
    numeral: "01",
    copy: "Build a basket from tokenized stocks — you set the weights.",
    href: "/create",
    Motif: WeightBarsMotif,
  },
  {
    numeral: "02",
    copy: "Buy any basket at exact weights. Seconds to settle, redeemable anytime.",
    href: "/explore",
    Motif: HexPlusMotif,
  },
  {
    numeral: "03",
    copy: "Post your thesis, build a following, climb the board.",
    href: "/leaderboard",
    Motif: PromptMotif,
  },
] as const;

export function FlowSection() {
  return (
    <section
      aria-labelledby="flow-heading"
      className="border-t border-border py-16 dark:border-border/60"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section header — tracked mono eyebrow + the one line. */}
        <SectionHeader
          id="flow-heading"
          label="CREATE · MINT · SHARE"
          lead="From pick to proof — every move lands on-chain."
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
