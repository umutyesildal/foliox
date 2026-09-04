"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { Button } from "@/components/ui/button";
import { useClusterHealth } from "@/components/shell/use-cluster-health";
import {
  WalletPickerMenu,
  useMenuDismiss,
  useWalletConnect,
  walletGlyph,
} from "@/components/shell/wallet-picker";
import { truncateAddress } from "@/lib/format";
import { RPC_ENDPOINT, clusterFromEndpoint } from "@/lib/wallet";
import { cn } from "@/lib/utils";

// py-2.5 keeps wallet menu entries at a ≥40px touch target on phones.
const menuButtonClasses =
  "w-full rounded-sm px-2 py-2.5 text-left text-sm text-popover-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

/**
 * Custom wallet control (the wallet-adapter MultiButton is intentionally not
 * used). States: disconnected (wallet picker), connecting, connected
 * (truncated mono address + copy/disconnect menu), wrong network / RPC
 * unreachable, and rejected-signature or other wallet errors as an inline
 * alert that auto-clears. The disconnected picker (with wallet glyphs) is
 * shared with the Create wizard banner via wallet-picker.tsx.
 */
export function WalletButton({ className }: { className?: string }) {
  const { wallets, wallet, publicKey, connecting, connected, disconnect } = useWallet();
  const { error, clearError, requestConnect } = useWalletConnect();
  const health = useClusterHealth(connected);
  const cluster = clusterFromEndpoint(RPC_ENDPOINT);

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  // Close the menu on outside pointer down or Escape; Escape returns focus to
  // the trigger so keyboard users stay in place.
  useMenuDismiss({
    open,
    onClose: () => setOpen(false),
    containerRef,
    onEscape: () => triggerRef.current?.focus(),
  });

  // Auto-clear the inline wallet error alert.
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => clearError(), 8000);
    return () => window.clearTimeout(timer);
  }, [error, clearError]);

  const handleDisconnect = () => {
    setOpen(false);
    clearError();
    disconnect().catch(() => {
      // Disconnect failures leave the previous state intact; the header
      // reflects reality on the next wallet event.
    });
  };

  const handleCopy = () => {
    if (!publicKey) return;
    navigator.clipboard
      ?.writeText(publicKey.toBase58())
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        setCopied(false);
      });
  };

  const isConnected = connected && publicKey !== null;
  const ConnectedGlyph = isConnected ? walletGlyph(wallet?.adapter.name ?? "") : undefined;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {isConnected ? (
        <Button
          ref={triggerRef}
          variant="outline"
          size="sm"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="font-mono tabular-nums">
            {truncateAddress(publicKey.toBase58())}
          </span>
        </Button>
      ) : (
        <Button
          ref={triggerRef}
          variant="outline"
          size="sm"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          disabled={connecting}
          onClick={() => setOpen((v) => !v)}
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </Button>
      )}

      {isConnected && health === "unreachable" && !open && (
        <p
          role="alert"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-md border border-destructive/30 bg-popover p-2 text-xs leading-5 text-destructive"
        >
          RPC unreachable ({cluster}). The wallet may be on a different network.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-md border border-destructive/30 bg-popover p-2 text-xs leading-5"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-destructive">{error.message}</p>
            <button
              type="button"
              onClick={clearError}
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {open && isConnected && (
        <div
          id={menuId}
          role="menu"
          aria-label="Wallet"
          className="absolute right-0 top-full z-20 mt-2 w-60 rounded-md border border-border bg-popover p-1 text-popover-foreground"
        >
          <p className="flex items-center gap-2 px-2 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">
            {ConnectedGlyph ? <ConnectedGlyph className="size-3.5 shrink-0" /> : null}
            <span className="truncate">
              {wallet?.adapter.name ?? "Wallet"} · {cluster}
            </span>
          </p>
          <button role="menuitem" type="button" onClick={handleCopy} className={menuButtonClasses}>
            {copied ? "Address copied" : "Copy address"}
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={handleDisconnect}
            className={menuButtonClasses}
          >
            Disconnect
          </button>
        </div>
      )}

      {open && !isConnected && (
        <WalletPickerMenu
          id={menuId}
          wallets={wallets}
          onPick={(name, ready) => {
            setOpen(false);
            requestConnect(name, ready);
          }}
        />
      )}
    </div>
  );
}
