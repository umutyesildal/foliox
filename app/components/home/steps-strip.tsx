import Link from "next/link";

/**
 * Steps strip — PICK · OWN · SHARE, the user-outcome steps.
 *
 * Owner feedback (2026-09-12): "satmak istediğimiz ürün tam olarak mint
 * değil" — the old CREATE · MINT · SHARE steps described program
 * operations; this strip speaks what the USER gets instead: pick a
 * basket, own it in your wallet, share the thesis. Merged into the live
 * proof section (2026-09-12) — no section chrome and no SectionHeader of
 * its own, just one quiet label line above a hairline-topped three-column
 * strip.
 *
 * Rendered by LiveProofSection below its two-column grid; the parent
 * supplies the outer container padding, this component draws only the
 * inner divider + strip. The motifs and the hairline-left column language
 * are transplanted verbatim from the deleted flow-section
 * (NEON FOUNDRY de-Rome pass, 2026-09-12): bare terminal columns, no
 * card chrome, line-drawn motifs that ink up muted→foreground on hover
 * (≤200ms, reduced-motion honored), whisper-quiet mono numerals.
 */

/** 01. PICK — stacked weights: three horizontal bars of descending
 *  width, each carrying a small square knob — echoes the weights editor.
 *  The act of choosing your stocks and their weights.
 *  (NEON FOUNDRY, 2026-09-12.) */
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

/** 02. OWN — a hexagon outline with a plus sign at its center: your
 *  basket, whole and held, inside the FOUNDRY MARK container. The act
 *  of holding something that is yours. (NEON FOUNDRY, 2026-09-12.) */
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
    copy: "Browse baskets, pick your stocks and weights.",
    href: "/create",
    Motif: WeightBarsMotif,
  },
  {
    numeral: "02",
    copy: "Hold your basket in your wallet — redeemable anytime.",
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

export function StepsStrip() {
  return (
    <div
      aria-label="How it works"
      className="mt-14 border-t border-border/50 pt-12"
    >
      {/* One quiet line above the steps — deliberately not a SectionHeader:
          the live-proof grid above carries the headline register. */}
      <p className="section-label">PICK · OWN · SHARE</p>
      <p className="mt-2 text-sm text-muted-foreground">
        From pick to proof — every move lands on-chain.
      </p>

      {/* Same hairline-left column language as the old flow section,
          tightened for the strip (gap-y-10 vs 12, mt-10 vs 12). */}
      <ol className="mt-10 grid grid-cols-1 gap-y-10 sm:grid-cols-3">
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
  );
}
