"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NetworkIndicator } from "@/components/shell/network-indicator";
import { WalletButton } from "@/components/shell/wallet-button";
import { CONTEXT_ACTIONS, PRIMARY_NAV, isRouteActive } from "@/components/shell/nav-items";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// py-2.5 keeps every disclosure link a ≥40px touch target on phones.
const mobileLinkClasses =
  "rounded-md px-2 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = isRouteActive(pathname, href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-2.5 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

/**
 * Site header: FolioX wordmark (a tiny monochrome column glyph + display-face
 * text — roman-empire experiment; the suffix stays Geist), primary nav
 * (Stocks/ETFs/Baskets), contextual actions (Create/Portfolio), network
 * indicator, wallet button, and a no-dependency mobile disclosure nav.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  // Close the disclosure whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes the disclosure and returns focus to the toggle, so keyboard
  // users do not fall back to the top of the document.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 dark:border-border/40">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center rounded-sm font-[family-name:var(--font-display)] font-semibold tracking-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {/* Tiny monochrome column mark — plain-stroke SVG, no mascot, no color */}
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            className="mr-2 shrink-0 text-foreground/50"
          >
            {/* abacus + capital */}
            <path d="M2.5 3h11M4 5.6h8" />
            {/* fluted shaft */}
            <path d="M5.5 5.6v6.8M8 5.6v6.8M10.5 5.6v6.8" />
            {/* base */}
            <path d="M3.5 14h9" />
          </svg>
          FolioX
          <span className="hidden font-sans font-normal text-muted-foreground sm:inline">
            {" "}
            · xStocks baskets
          </span>
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden items-center gap-5 md:flex">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 lg:flex">
            {CONTEXT_ACTIONS.map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                className={buttonVariants({
                  // Create stays the primary action; Portfolio is demoted to a
                  // quiet ghost control (B4).
                  variant: index === 0 ? "default" : "ghost",
                  size: "sm",
                })}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <NetworkIndicator className="hidden sm:inline-flex" />
          <WalletButton />

          <button
            ref={menuButtonRef}
            type="button"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              // The menu toggle is the primary nav control below md — give it
              // a ≥40px touch target there; desktop sizes are unchanged.
              "max-md:h-10 max-md:px-3.5",
              "md:hidden",
            )}
            aria-expanded={mobileOpen}
            aria-controls="foliox-mobile-nav"
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          id="foliox-mobile-nav"
          aria-label="Primary mobile"
          className="border-t border-border bg-background dark:border-border/40 md:hidden"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-0.5 px-4 py-3 sm:px-6">
            {PRIMARY_NAV.map((item) => {
              const active = isRouteActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    mobileLinkClasses,
                    active && "bg-muted text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
            <div aria-hidden="true" className="my-2 h-px bg-border dark:bg-border/40" />
            {CONTEXT_ACTIONS.map((item) => (
              <Link key={item.href} href={item.href} className={mobileLinkClasses}>
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
