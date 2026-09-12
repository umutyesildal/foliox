/**
 * Ledger section — replaces the old TraditionalVsTokenized card. No card, no
 * cell borders: an inscription layout. A center spine of dimension labels in
 * the shared mono section-label style, the traditional rail muted on the
 * left, the tokenized rail in full foreground on the right, each tokenized
 * phrase opened by a 6px yellow tick. The only saturated color on the page:
 * the hero chip, these ticks, and the Tokenized header's 2px primary
 * underline.
 */

import { SectionHeader } from "@/components/ui/section-header";

const ROWS = [
  {
    dimension: "Settlement",
    traditional: "T+1 · broker rails",
    tokenized: "Seconds · on-chain",
  },
  {
    dimension: "Access",
    traditional: "Broker account · market hours",
    tokenized: "Any wallet · 24/7",
  },
  {
    dimension: "Ownership",
    traditional: "Street name, at the broker",
    tokenized: "The token is the share",
  },
  {
    dimension: "Transferability",
    traditional: "Only the broker moves it",
    tokenized: "Wallet to wallet",
  },
  {
    dimension: "Transparency",
    traditional: "NAV once a day",
    tokenized: "Verifiable on-chain, anytime",
  },
] as const;

/** Fixed 3-column template shared by headers and rows so the halves align.
 *  The spine narrows to 3rem on phones so each rail keeps a readable line. */
const GRID =
  "grid grid-cols-[1fr_3rem_1fr] items-center gap-x-2 sm:grid-cols-[1fr_7rem_1fr] sm:gap-x-4";

/** One inscription row (local to this section — the spine layout is ledger-
 *  specific): the traditional rail muted and right-aligned, the mono
 *  dimension label on the center spine, and the tokenized rail in full
 *  foreground opened by a 6px primary tick. */
function SpineRow({
  dimension,
  traditional,
  tokenized,
}: {
  dimension: string;
  traditional: string;
  tokenized: string;
}) {
  return (
    <li className={`${GRID} h-14 border-b border-border/50`}>
      <span className="text-right text-xs leading-5 text-muted-foreground/60">
        {traditional}
      </span>
      <span className="section-label text-center">
        {dimension}
      </span>
      <span className="flex items-center gap-2.5 text-left text-xs leading-5 text-foreground">
        <span
          aria-hidden="true"
          className="h-4 w-1.5 shrink-0 bg-primary"
        />
        {tokenized}
      </span>
    </li>
  );
}

export function LedgerSection() {
  return (
    <section
      aria-labelledby="ledger-heading"
      className="border-t border-border py-16 dark:border-border/60"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionHeader
          id="ledger-heading"
          size="display"
          label="SAME EXPOSURE. DIFFERENT RAILS."
          lead="What changes is how you hold it."
        />

        {/* Column headers — the Tokenized side carries the 2px primary
            underline, inherited from the component this replaces. */}
        <div className={`${GRID} mt-10`}>
          <span className="border-b-2 border-transparent pb-1.5 text-right font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Traditional
          </span>
          <span aria-hidden="true" />
          <span className="self-start border-b-2 border-primary/70 pb-1.5 text-left font-mono text-[11px] uppercase tracking-wide text-foreground">
            Tokenized
          </span>
        </div>

        <ul>
          {ROWS.map((row) => (
            <SpineRow
              key={row.dimension}
              dimension={row.dimension}
              traditional={row.traditional}
              tokenized={row.tokenized}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
