"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";

import { NetworkIndicator } from "@/components/shell/network-indicator";
import { WalletButton } from "@/components/shell/wallet-button";
import { CONTEXT_ACTIONS, PRIMARY_NAV, isRouteActive } from "@/components/shell/nav-items";
import { useHandleFlags, writeHandleClaimed } from "@/components/social/handle-onboarding";
import { ProfileEditorModal } from "@/components/social/profile-editor";
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
 * FolioX mark — the FOUNDRY MARK (spec §7, de-Rome pass 2026-09-12): a
 * hexagon outline containing three descending filled bars — reads as index
 * weights in a container and abstractly as an angular F. The canonical
 * geometry lives here (viewBox 0 0 24 24, stroke-width 1.7, miter joins) and
 * is reused verbatim in app/icon.svg, apple-icon.tsx and
 * opengraph-image.tsx (same relative geometry, different scale/colors).
 * currentColor throughout; decorative only.
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
      strokeLinejoin="miter"
      className="mr-2 shrink-0"
    >
      {/* hexagon container, sharp miter joins */}
      <path
        d="M12 2.5 L20.2 7.25 V16.75 L12 21.5 L3.8 16.75 V7.25 Z"
        strokeWidth="1.7"
      />
      {/* three descending weight bars (filled rects, no stroke) */}
      <g fill="currentColor" stroke="none">
        <rect x="8" y="8.1" width="8.6" height="2.1" />
        <rect x="8" y="11.95" width="6.6" height="2.1" />
        <rect x="8" y="15.8" width="4.6" height="2.1" />
      </g>
    </svg>
  );
}

/**
 * Persistent "Claim handle" chip for a connected wallet that has not claimed
 * one yet. Flag-based (foliox:handle-claimed:<wallet> in localStorage — the
 * editor modal itself does the real profile check on open). Yellow accent
 * wash mirroring the followed chip on creator pages: the Create button keeps
 * the solid-yellow slot.
 */
function ClaimHandleChip() {
  const { publicKey, connected } = useWallet();
  const wallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const { claimed } = useHandleFlags(wallet);
  const [open, setOpen] = useState(false);

  if (!connected || !wallet || claimed) return null;

  return (
    <>
      <button
        type="button"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          // Hidden below sm like the network indicator — the connected
          // address + menu button already fill a phone header.
          "hidden border-primary/50 bg-accent text-accent-foreground hover:bg-accent/80 sm:inline-flex",
        )}
        onClick={() => setOpen(true)}
      >
        Claim handle
      </button>
      <ProfileEditorModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          if (wallet) writeHandleClaimed(wallet);
          setOpen(false);
        }}
        title="Claim your handle"
        submitLabel="Claim handle"
      />
    </>
  );
}

/**
 * Site header: FolioX wordmark (FOUNDRY MARK + display-face text — Chakra
 * Petch under NEON FOUNDRY, with the trailing X in text-primary as the yellow
 * accent; the suffix stays Geist), primary nav (Stocks/ETFs/Baskets),
 * contextual actions (Create/Portfolio), network indicator, wallet button,
 * and a no-dependency mobile disclosure nav.
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
          Folio<span className="text-primary">X</span>
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

          <ClaimHandleChip />
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
