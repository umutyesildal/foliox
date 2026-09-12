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
        // Terminal nav cell: mono uppercase micro-label (house rule —
        // uppercase + tracked labels use mono). The active route reads
        // YELLOW: yellow text on the dim accent wash pill, never a full
        // yellow fill (yellow is for CTAs, not for nav chrome at large).
        "rounded-md px-2.5 py-1 font-mono text-xs uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "bg-accent text-primary-text"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

/**
 * FolioX mark — a plain laurel wreath (owner feedback 2026-09-03: the
 * F-in-laurel monogram read badly; the wreath alone is the mark). Two
 * mirrored branches with leaf ticks rise from a bound base and open at the
 * top, leaving the center empty. currentColor throughout; decorative only.
 * The same geometry (minus the finer ticks at small sizes) is used in
 * app/icon.svg, apple-icon.tsx and opengraph-image.tsx.
 */
function LogoMark({ size = 21 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      className="mr-2 shrink-0"
    >
      {/* wreath: two mirrored branches + the binding arc at the base */}
      <g strokeWidth="1.5">
        <path d="M8.6 20.7C5.7 19.2 3.9 16.1 3.9 12.7c0-2.7.6-5.3 1.7-7.5" />
        <path d="M15.4 20.7c2.9-1.5 4.7-4.6 4.7-8 0-2.7-.6-5.3-1.7-7.5" />
        <path d="M8.6 20.7c1.1.9 2.3 1.4 3.4 1.4s2.3-.5 3.4-1.4" />
        {/* leaf ticks, outboard of each branch */}
        <path d="M4.6 7.9 3.1 7.5M3.9 11.3 2.3 11.7M4.4 14.9 2.9 15.7M5.8 18 4.4 19.1" />
        <path d="m19.4 7.9 1.5-.4M20.1 11.3l1.6.4M19.6 14.9l1.5.8M18.2 18l1.4 1.1" />
      </g>
    </svg>
  );
}

/**
 * Site header: FolioX wordmark (plain laurel wreath mark + display-face text —
 * Chakra Petch under NEON FOUNDRY; the suffix stays Geist), primary nav
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
          className="flex items-center rounded-sm font-display font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <LogoMark />
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
                    // Active route reads yellow (accent wash + primary text),
                    // matching the desktop nav's active pill.
                    active && "bg-accent text-primary-text",
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
