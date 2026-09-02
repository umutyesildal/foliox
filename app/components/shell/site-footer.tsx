import Link from "next/link";

/**
 * Legal footer. Copy is fixed by AGENTS.md §10 / brand.md — keep the
 * LEGAL_REVIEW_REQUIRED placeholders until counsel approves replacements.
 */
export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 pb-10 text-xs text-muted-foreground sm:px-6">
      <div className="border-t border-border/40 pt-6">
        Not investment advice · xStocks are structured instruments ·{" "}
        <Link
          href="/legal"
          className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Risks &amp; Disclosures
        </Link>
      </div>
    </footer>
  );
}
