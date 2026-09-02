import type { ReactNode } from "react";
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
 * Real footer (designer critique item 7), slimmed (owner complaint 2): four
 * columns — Product, Data, Legal, Protocol — compressed into a quiet base bar
 * (text-xs, py-5 total vertical rhythm) instead of a full section. The
 * not-advice one-liner stays as the bottom row. Copy is fixed by AGENTS.md §10
 * / brand.md; keep the LEGAL_REVIEW_REQUIRED placeholder until counsel
 * approves replacements.
 *
 * `mt-auto` + `data-slot="site-footer"`: pages render the footer as the last
 * element of their tree inside <main>; globals.css turns the page tree into a
 * flex column on footer pages, so mt-auto pins the footer to the viewport
 * bottom on short pages.
 */
export function SiteFooter() {
  return (
    <footer
      data-slot="site-footer"
      className="mt-auto w-full border-t border-border/60 pb-5 pt-5 text-xs text-muted-foreground"
    >
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 md:grid-cols-4">
        {/* Product */}
        <FooterColumn title="Product">
          <ul className="flex flex-col gap-1.5">
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
        </FooterColumn>

        {/* Data */}
        <FooterColumn title="Data">
          <ul className="flex flex-col gap-1.5">
            <li>
              <Link
                href="/providers"
                className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Providers
              </Link>
            </li>
            <li className="leading-4">Every figure names its source and as-of time.</li>
          </ul>
        </FooterColumn>

        {/* Legal */}
        <FooterColumn title="Legal">
          <ul className="flex flex-col gap-1.5">
            <li>
              <Link
                href="/legal"
                className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Risks &amp; Disclosures
              </Link>
            </li>
            <li className="leading-4">
              <LegalReviewTag />
            </li>
          </ul>
        </FooterColumn>

        {/* Protocol */}
        <FooterColumn title="Protocol">
          <ul className="flex flex-col gap-1.5">
            <li className="font-mono">whitelist · basket_factory · basket</li>
            <li className="leading-4">immutable · oracle-free redeem</li>
          </ul>
        </FooterColumn>
      </div>

      {/* Bottom row — not-advice one-liner (kept verbatim) */}
      <div className="mt-4 border-t border-border/60 pt-3">
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

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-foreground">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
