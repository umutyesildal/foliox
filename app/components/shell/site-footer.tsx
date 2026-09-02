import Link from "next/link";

import { LegalReviewTag } from "@/components/create";

const PRODUCT_LINKS: { href: string; label: string }[] = [
  { href: "/stocks", label: "Stocks" },
  { href: "/etfs", label: "ETFs" },
  { href: "/explore", label: "Baskets" },
  { href: "/create", label: "Create" },
  { href: "/portfolio", label: "Portfolio" },
];

/**
 * Real footer (designer critique item 7): four columns — Product, Data, Legal,
 * Protocol — with the not-advice one-liner kept as the bottom row. Copy is
 * fixed by AGENTS.md §10 / brand.md; keep the LEGAL_REVIEW_REQUIRED
 * placeholder until counsel approves replacements.
 */
export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 pb-10 text-xs text-muted-foreground sm:px-6">
      <div className="border-t border-[hsl(var(--border-strong))] pt-8">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          {/* Product */}
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-foreground">
              Product
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {PRODUCT_LINKS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Data */}
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-foreground">
              Data
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              <li>
                <Link
                  href="/providers"
                  className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Providers
                </Link>
              </li>
              <li className="leading-5">Every figure names its source and as-of time.</li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-foreground">
              Legal
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              <li>
                <Link
                  href="/legal"
                  className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Risks &amp; Disclosures
                </Link>
              </li>
              <li className="leading-5">
                <LegalReviewTag />
              </li>
            </ul>
          </div>

          {/* Protocol */}
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-foreground">
              Protocol
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              <li className="font-mono">whitelist</li>
              <li className="font-mono">basket_factory</li>
              <li className="font-mono">basket</li>
              <li className="leading-5">immutable · oracle-free redeem</li>
            </ul>
          </div>
        </div>

        {/* Bottom row — not-advice one-liner (kept verbatim) */}
        <div className="mt-8 border-t border-border/60 pt-5">
          Not investment advice · xStocks are structured instruments ·{" "}
          <Link
            href="/legal"
            className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Risks &amp; Disclosures
          </Link>
        </div>
      </div>
    </footer>
  );
}
