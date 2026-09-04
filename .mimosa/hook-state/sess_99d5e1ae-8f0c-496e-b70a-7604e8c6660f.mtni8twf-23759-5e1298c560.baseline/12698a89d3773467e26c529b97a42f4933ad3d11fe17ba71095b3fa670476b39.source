/**
 * The standing legal placeholder. Every surface with legal/risk language keeps
 * this visible until counsel approves replacements (AGENTS.md §12, brand.md).
 * Rendered muted so it is present without shouting — but never removed.
 */
export function LegalReviewTag({ className }: { className?: string }) {
  return (
    <span
      role="note"
      aria-label="Placeholder copy pending legal review"
      className={
        "inline-flex items-center rounded-[4px] border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-muted-foreground " +
        (className ?? "")
      }
    >
      LEGAL_REVIEW_REQUIRED
    </span>
  );
}
