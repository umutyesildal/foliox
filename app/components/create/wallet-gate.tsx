"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { AlertTriangle } from "lucide-react";

import { useWalletFeedback } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { describeWalletError } from "@/lib/wallet";

function isReady(readyState: WalletReadyState): boolean {
  return (
    readyState === WalletReadyState.Installed ||
    readyState === WalletReadyState.Loadable
  );
}

/**
 * Wallet gate for the top of the Create wizard. The steps stay browsable, but
 * while no wallet is connected this compact banner sits above the stepper
 * (warning tone, muted border) with an explicit connect action — deploying
 * signs a create_basket transaction from the creator's wallet. The connect
 * flow mirrors the header WalletButton: select first, connect once the wallet
 * lands (avoids the stale-wallet race).
 */
export function WalletGateBanner({ className }: { className?: string }) {
  const { wallets, wallet, connect, select, connecting } = useWallet();
  const { reportError, clearError } = useWalletFeedback();
  const pendingConnectRef = useRef(false);

  useEffect(() => {
    if (!pendingConnectRef.current || !wallet) return;
    if (!isReady(wallet.readyState)) return;
    pendingConnectRef.current = false;
    connect().catch((err: unknown) => {
      const e = err as { name?: string; message?: string };
      reportError(e?.name ?? "WalletError", describeWalletError(e));
    });
  }, [wallet, connect, reportError]);

  const requestConnect = (name: WalletName, ready: boolean) => {
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
  };

  const readyWallets = wallets.filter((entry) => isReady(entry.readyState));

  return (
    <div
      role="note"
      aria-label="Wallet not connected"
      className={
        "flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 " +
        (className ?? "")
      }
    >
      <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Wallet not connected</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Deploying signs a create_basket transaction from your wallet. Browse
          the steps freely — connect before you reach Deploy.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {readyWallets.length === 0 ? (
          <Button type="button" variant="outline" size="sm" disabled>
            No wallet detected
          </Button>
        ) : (
          readyWallets.map((entry) => (
            <Button
              key={entry.adapter.name}
              type="button"
              variant="outline"
              size="sm"
              disabled={connecting}
              onClick={() => requestConnect(entry.adapter.name, true)}
            >
              {connecting ? "Connecting…" : `Connect ${entry.adapter.name}`}
            </Button>
          ))
        )}
      </div>
    </div>
  );
}
