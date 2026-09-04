"use client";

import { useCallback, useEffect, useRef, type ComponentType } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";

import { useWalletFeedback } from "@/app/providers";
import { describeWalletError } from "@/lib/wallet";
import { cn } from "@/lib/utils";

export function isWalletReady(readyState: WalletReadyState): boolean {
  return (
    readyState === WalletReadyState.Installed ||
    readyState === WalletReadyState.Loadable
  );
}

/**
 * Simplified monochrome Phantom glyph (ghost silhouette with cut-out eyes).
 * ~16px at the default size-4; inherits currentColor.
 */
export function PhantomGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
    >
      <path d="M12 3a7 7 0 0 0-7 7v9.4c0 .83.96 1.28 1.6.74l1.5-1.26 1.9 1.6a1.9 1.9 0 0 0 2.44 0l1.46-1.23 1.5 1.26c.64.54 1.6.09 1.6-.74V10a7 7 0 0 0-7-7Zm-2.9 6.4h1.7v1.9H9.1v-1.9Zm4.1 0h1.7v1.9H13.1v-1.9Z" />
    </svg>
  );
}

/**
 * Simplified monochrome Solflare glyph (sun with alternating flare rays).
 * ~16px at the default size-4; inherits currentColor.
 */
export function SolflareGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
    >
      <circle cx="12" cy="12" r="3.6" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M12 2.2v3.1" />
        <path d="M12 18.7v3.1" />
        <path d="M2.2 12h3.1" />
        <path d="M18.7 12h3.1" />
        <path d="M5.1 5.1l2.1 2.1" className="opacity-60" />
        <path d="M16.8 16.8l2.1 2.1" className="opacity-60" />
        <path d="M18.9 5.1l-2.1 2.1" className="opacity-60" />
        <path d="M7.2 16.8l-2.1 2.1" className="opacity-60" />
      </g>
    </svg>
  );
}

const KNOWN_GLYPHS: Record<string, ComponentType<{ className?: string }>> = {
  Phantom: PhantomGlyph,
  Solflare: SolflareGlyph,
};

/** Best-effort monochrome glyph for a wallet name (undefined → none). */
export function walletGlyph(name: string): ComponentType<{ className?: string }> | undefined {
  return KNOWN_GLYPHS[name];
}

/**
 * Shared select-then-connect flow. `select()` updates wallet-adapter context
 * asynchronously, so the actual `connect()` fires once the selected wallet
 * lands and is ready (avoids the stale-wallet race). Errors surface through
 * the global wallet feedback channel.
 */
export function useWalletConnect() {
  const { wallet, connect, select } = useWallet();
  const { error, clearError, reportError } = useWalletFeedback();
  const pendingConnectRef = useRef(false);

  useEffect(() => {
    if (!pendingConnectRef.current || !wallet) return;
    if (!isWalletReady(wallet.readyState)) return;
    pendingConnectRef.current = false;
    connect().catch((err: unknown) => {
      const e = err as { name?: string; message?: string };
      reportError(e?.name ?? "WalletError", describeWalletError(e));
    });
  }, [wallet, connect, reportError]);

  const requestConnect = useCallback(
    (name: WalletName, ready: boolean) => {
      if (!ready) return;
      clearError();
      if (wallet?.adapter.name === name) {
        connect().catch((err: unknown) => {
          const e = err as { name?: string; message?: string };
          reportError(e?.name ?? "WalletError", describeWalletError(e));
        });
      } else {
        pendingConnectRef.current = true;
        select(name);
      }
    },
    [wallet, connect, select, clearError, reportError],
  );

  return { requestConnect, error, clearError, reportError };
}

/**
 * Dismiss behavior shared by the pop-up wallet menus: close on outside
 * pointer down or Escape. `onEscape` may restore focus to the trigger.
 */
export function useMenuDismiss({
  open,
  onClose,
  containerRef,
  onEscape,
}: {
  open: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  onEscape?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        onEscape?.();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, containerRef, onEscape]);
}

// py-2.5 keeps wallet menu entries at a ≥40px touch target on phones.
const menuEntryClasses =
  "w-full rounded-sm px-2 py-2.5 text-left text-sm text-popover-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

/**
 * Wallet picker menu used everywhere wallets are listed (header control and
 * the Create wizard banner). Entries carry their monochrome glyph and a
 * Detected / Not detected hint; not-ready wallets are disabled.
 */
export function WalletPickerMenu({
  id,
  wallets,
  onPick,
  className,
}: {
  id: string;
  wallets: ReturnType<typeof useWallet>["wallets"];
  onPick: (name: WalletName, ready: boolean) => void;
  className?: string;
}) {
  return (
    <div
      id={id}
      role="menu"
      aria-label="Connect a wallet"
      className={cn(
        "absolute right-0 top-full z-20 mt-2 w-60 rounded-md border border-border bg-popover p-1 text-popover-foreground",
        className,
      )}
    >
      {wallets.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          No wallets registered.
        </p>
      )}
      {wallets.map((entry) => {
        const ready = isWalletReady(entry.readyState);
        const Glyph = walletGlyph(entry.adapter.name);
        return (
          <button
            key={entry.adapter.name}
            role="menuitem"
            type="button"
            disabled={!ready}
            title={ready ? `Connect ${entry.adapter.name}` : `${entry.adapter.name} not detected`}
            onClick={() => onPick(entry.adapter.name, ready)}
            className={cn(menuEntryClasses, "flex items-center gap-2.5")}
          >
            {Glyph ? (
              <Glyph className="size-4 shrink-0 text-muted-foreground" />
            ) : null}
            <span className="flex-1 truncate">{entry.adapter.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {ready ? "Detected" : "Not detected"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
