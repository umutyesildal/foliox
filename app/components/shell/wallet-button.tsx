"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";

import { useWalletFeedback } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { useClusterHealth } from "@/components/shell/use-cluster-health";
import { truncateAddress } from "@/lib/format";
import { RPC_ENDPOINT, clusterFromEndpoint, describeWalletError } from "@/lib/wallet";
import { cn } from "@/lib/utils";

const READY_STATES = [WalletReadyState.Installed, WalletReadyState.Loadable];

function isReady(readyState: WalletReadyState): boolean {
  return readyState === WalletReadyState.Installed ||
    readyState === WalletReadyState.Loadable;
}

const menuButtonClasses =
  "w-full rounded-sm px-2 py-1.5 text-left text-sm text-popover-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

/**
 * Custom wallet control (the wallet-adapter MultiButton is intentionally not
 * used). States: disconnected (wallet picker), connecting, connected
 * (truncated mono address + copy/disconnect menu), wrong network / RPC
 * unreachable, and rejected-signature or other wallet errors as an inline
 * alert that auto-clears.
 */
export function WalletButton({ className }: { className?: string }) {
  const { wallets, wallet, publicKey, connecting, connected, connect, disconnect, select } =
    useWallet();
  const { error, clearError, reportError } = useWalletFeedback();
  const health = useClusterHealth(connected);
  const cluster = clusterFromEndpoint(RPC_ENDPOINT);

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const pendingConnectRef = useRef(false);
  const menuId = useId();

  // Connecting must stay an explicit user action. `select()` updates context
  // asynchronously, so the actual `connect()` fires once the selected wallet
  // lands and is ready (avoids the stale-wallet race).
  useEffect(() => {
    if (!pendingConnectRef.current || !wallet) return;
    if (!isReady(wallet.readyState)) return;
    pendingConnectRef.current = false;
    connect().catch((err: unknown) => {
      const e = err as { name?: string; message?: string };
      reportError(e?.name ?? "WalletError", describeWalletError(e));
    });
  }, [wallet, connect, reportError]);

  // Close the menu on outside pointer down or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        // Return focus to the trigger so keyboard users stay in place.
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Auto-clear the inline wallet error alert.
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => clearError(), 8000);
    return () => window.clearTimeout(timer);
  }, [error, clearError]);

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

  const handleDisconnect = useCallback(() => {
    setOpen(false);
    clearError();
    disconnect().catch(() => {
      // Disconnect failures leave the previous state intact; the header
      // reflects reality on the next wallet event.
    });
  }, [disconnect, clearError]);

  const handleCopy = useCallback(() => {
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
  }, [publicKey]);

  const isConnected = connected && publicKey !== null;

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
          <p className="px-2 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">
            {wallet?.adapter.name ?? "Wallet"} · {cluster}
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
        <div
          id={menuId}
          role="menu"
          aria-label="Connect a wallet"
          className="absolute right-0 top-full z-20 mt-2 w-60 rounded-md border border-border bg-popover p-1 text-popover-foreground"
        >
          {wallets.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No wallets registered.
            </p>
          )}
          {wallets.map((entry) => {
            const ready = isReady(entry.readyState);
            return (
              <button
                key={entry.adapter.name}
                role="menuitem"
                type="button"
                disabled={!ready}
                title={ready ? `Connect ${entry.adapter.name}` : `${entry.adapter.name} not detected`}
                onClick={() => {
                  setOpen(false);
                  requestConnect(entry.adapter.name, ready);
                }}
                className={cn(menuButtonClasses, "flex items-center justify-between gap-2")}
              >
                <span>{entry.adapter.name}</span>
                <span className="text-xs text-muted-foreground">
                  {ready ? "Detected" : "Not detected"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
