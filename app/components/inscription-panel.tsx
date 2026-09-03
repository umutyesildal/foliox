/**
 * Inscription panel — a carved-stone brand plaque in the style of a Roman
 * inscription (TABULA / lapidary dedication). Replaces the old framed market
 * screenshot on the home page: static brand art, no data claims, no live
 * anything. Double frame (outer border + inner border with a 6px gap — the
 * classic inscription molding), sharp corners (inscriptions are not rounded),
 * generous padding, and three engraved imperative lines in the display face
 * (Cinzel via --font-display). Monochrome only — border, bg-card, foreground
 * at 90% — plus a single 1px inset highlight to suggest light on stone. The
 * bottom line stamps the year in Roman numerals: 2026 = MMXXVI.
 *
 * Decorative and static; the whole panel is presentational (no aria claims),
 * but the text itself is real content, so it stays readable to screen readers.
 */
export function InscriptionPanel() {
  return (
    <div className="rounded-sm border border-border bg-card p-[6px] shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)]">
      <div className="rounded-sm border border-border/60 px-6 py-10 text-center sm:px-10 sm:py-12">
        {/* Ornament rule — pure glyphs, muted, purely decorative. */}
        <p
          aria-hidden="true"
          className="font-[family-name:var(--font-display)] text-sm tracking-[0.35em] text-muted-foreground"
        >
          — ✦ —
        </p>

        {/* The three engraved lines: create → mint → redeem. */}
        <div className="mt-8 space-y-4 sm:space-y-5">
          {[
            "I · CREATE — fix your weights",
            "II · MINT — seed the vault",
            "III · REDEEM — burn for your share",
          ].map((line) => (
            <p
              key={line}
              className="font-[family-name:var(--font-display)] text-xl font-medium uppercase leading-snug tracking-[0.14em] text-foreground/90 sm:text-3xl sm:tracking-[0.18em]"
            >
              {line}
            </p>
          ))}
        </div>

        {/* Bottom stamp — year in Roman numerals. */}
        <p className="mt-10 font-mono text-xs tracking-[0.25em] text-muted-foreground">
          FOLIOX · MMXXVI · IMMUTABLE
        </p>
      </div>
    </div>
  );
}
