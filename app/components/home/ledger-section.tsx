/**
 * Ledger section — replaces the old TraditionalVsTokenized card. No card, no
 * cell borders: a marble-inscription layout. A center spine of dimensions in
 * Cinzel small caps (Cinzel's lowercase are small capitals — the inscription
 * face itself), the traditional rail muted on the left, the tokenized rail in
 * full foreground on the right, each tokenized phrase opened by a 6px
 * imperial tick. The only purple on the page: the hero chip, these ticks, and
 * the Tokenized header's 2px imperial underline.
 */

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

export function LedgerSection() {
  return (
    <section
      aria-labelledby="ledger-heading"
      className="border-t border-border py-16 dark:border-border/60"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <header>
          <h2
            id="ledger-heading"
            className="font-[family-name:var(--font-display)] text-xl font-medium tracking-[0.06em] text-foreground md:text-2xl"
          >
            SAME EXPOSURE. DIFFERENT RAILS.
          </h2>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            What changes is how you hold it.
          </p>
        </header>

        {/* Column headers — the Tokenized side carries the 2px imperial
            underline, inherited from the component this replaces. */}
        <div className={`${GRID} mt-10`}>
          <span className="border-b-2 border-transparent pb-1.5 text-right font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Traditional
          </span>
          <span aria-hidden="true" />
          <span className="self-start border-b-2 border-[hsl(var(--imperial)/0.7)] pb-1.5 text-left font-mono text-[11px] uppercase tracking-wide text-foreground">
            Tokenized
          </span>
        </div>

        <ul>
          {ROWS.map((row) => (
            <li key={row.dimension} className={`${GRID} h-14 border-b border-border/50`}>
              <span className="text-right text-xs leading-5 text-muted-foreground/60">
                {row.traditional}
              </span>
              <span className="text-center font-[family-name:var(--font-display)] text-xs font-medium tracking-[0.08em] text-muted-foreground">
                {row.dimension}
              </span>
              <span className="flex items-center gap-2.5 text-left text-xs leading-5 text-foreground">
                <span
                  aria-hidden="true"
                  className="h-4 w-1.5 shrink-0 bg-[hsl(var(--imperial))]"
                />
                {row.tokenized}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
