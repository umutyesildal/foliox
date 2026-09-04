"use client";

import { useId, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ChevronDown, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  WalletPickerMenu,
  isWalletReady,
  useMenuDismiss,
  useWalletConnect,
} from "@/components/shell/wallet-picker";

/**
 * Wallet gate for the top of the Create wizard. The steps stay browsable, but
 * while no wallet is connected this quiet banner sits above the stepper
 * (muted surface, single primary action) — deploying signs a create_basket
 * transaction from the creator's wallet. The single "Connect wallet" button
 * opens the exact picker menu the header control uses (same flow, same
 * glyphs), so there is one connect affordance per surface.
 */
export function WalletGateBanner({ className }: { className?: string }) {
  const { wallets, connecting } = useWallet();
  const { requestConnect } = useWalletConnect();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useMenuDismiss({
    open,
    onClose: () => setOpen(false),
    containerRef,
  });

  const hasReadyWallet = wallets.some((entry) => isWalletReady(entry.readyState));

  return (
    <div
      role="note"
      aria-label="Wallet not connected"
      className={
        "flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/50 p-3 " +
        (className ?? "")
      }
    >
      <Wallet className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Connect a wallet to deploy</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Deploying signs a create_basket transaction from your wallet. Browse
          the steps freely — connect before you reach Deploy.
        </p>
      </div>
      <div ref={containerRef} className="relative shrink-0">
        <Button
          type="button"
          size="sm"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          disabled={connecting || !hasReadyWallet}
          title={hasReadyWallet ? undefined : "No wallet detected"}
          onClick={() => setOpen((v) => !v)}
        >
          {connecting ? "Connecting…" : hasReadyWallet ? "Connect wallet" : "No wallet detected"}
          <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
        </Button>
        {open && (
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
    </div>
  );
}
