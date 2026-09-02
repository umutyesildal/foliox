"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NetworkIndicator } from "@/components/shell/network-indicator";
import { WalletButton } from "@/components/shell/wallet-button";
import { CONTEXT_ACTIONS, PRIMARY_NAV, isRouteActive } from "@/components/shell/nav-items";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const mobileLinkClasses =
  "rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

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
 * Site header: FolioX wordmark (text only), primary nav
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
    <header className="sticky top-0 z-10 border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center rounded-sm font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {/* Plain monochrome mark — pure CSS, no mascot */}
          <span
            aria-hidden="true"
            className="mr-2 inline-block size-2.5 shrink-0 rounded-[2px] bg-foreground/40"
          />
          FolioX
          <span className="hidden font-normal text-muted-foreground sm:inline">
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
          className="border-t border-border/40 bg-background md:hidden"
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
            <div aria-hidden="true" className="my-2 h-px bg-border/40" />
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
