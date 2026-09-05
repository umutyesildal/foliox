"use client";

import { useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";

import { Button } from "@/components/ui/button";
import { TxReviewModal } from "@/components/basket/tx-review-modal";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import {
  buildAccrueManagementFee,
  type ExpectedAccount,
} from "@/lib/transactions";
import { RPC_ENDPOINT } from "@/lib/wallet";

/**
 * Permissionless management-fee crank (basket::accrue_management_fee). Anyone
 * may run it; the caller only covers possible ATA rent. Offered on the detail
 * action rail (connected users) and quietly on the redeem page when the
 * accrual checkpoint is stale.
 */
export function AccrueCrankButton({
  basket,
  factory,
  creator,
  treasury,
  shareMint,
  constituents,
  /** Seconds since the last indexed accrual (null when unknown). */
  secondsSinceAccrual,
  variant = "outline",
  quiet = false,
}: {
  basket: string;
  factory: string;
  creator: string;
  treasury: string;
  shareMint: string;
  constituents: string[];
  secondsSinceAccrual: number | null;
  variant?: "outline" | "ghost" | "default";
  quiet?: boolean;
}) {
  const { publicKey, connected } = useWallet();
  const flow = useTransactionFlow();
  const [open, setOpen] = useState(false);
  const [expectedAccounts, setExpectedAccounts] = useState<ExpectedAccount[] | null>(
    null,
  );

  const keys = useMemo(() => {
    if (!publicKey) return null;
    try {
      return {
        basket: new PublicKey(basket),
        factory: new PublicKey(factory),
        creator: new PublicKey(creator),
        treasury: new PublicKey(treasury),
        shareMint: new PublicKey(shareMint),
        constituents,
        user: publicKey,
      };
    } catch {
      return null;
    }
  }, [basket, factory, creator, treasury, shareMint, constituents, publicKey]);

  const openReview = () => {
    if (!keys) return;
    const built = buildAccrueManagementFee(keys);
    setExpectedAccounts(built.expectedAccounts);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    // Once a signature exists the tx is sent — closing only hides the UI; the
    // confirmation keeps running and the page-level banner reports the outcome.
    if (!flow.state.signature) flow.reset();
  };

  /** Start (or Retry) the crank — re-invocable after a transient failure. */
  const startCrank = () => {
    if (!keys) return;
    void flow.run(() => buildAccrueManagementFee(keys).instructions, undefined, {
      describe: {
        kind: "crank",
        label: "fee accrual",
        successLine: "🎉 Done — fee accrued",
      },
    });
  };

  const elapsedLabel =
    secondsSinceAccrual === null
      ? null
      : secondsSinceAccrual < 3600
        ? `${Math.max(1, Math.floor(secondsSinceAccrual / 60))}m ago`
        : secondsSinceAccrual < 86400
          ? `${Math.floor(secondsSinceAccrual / 3600)}h ago`
          : `${Math.floor(secondsSinceAccrual / 86400)}d ago`;

  if (!connected || !publicKey) {
    if (quiet) return null;
    return (
      <p className="text-xs text-muted-foreground">
        Connect a wallet to run the fee accrual crank.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <Button variant={variant} size="sm" onClick={openReview}>
          Run fee accrual crank
        </Button>
        {elapsedLabel ? (
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            last accrual {elapsedLabel}
          </span>
        ) : null}
      </div>

      <TxReviewModal
        open={open}
        onClose={close}
        title="Accrue management fee"
        description="Streams the management fee since the last checkpoint — you only pay possible ATA rent."
        accounts={expectedAccounts ?? []}
        flowState={flow.state}
        onConfirm={startCrank}
        onRetry={startCrank}
        confirmLabel="Confirm"
        endpoint={RPC_ENDPOINT}
        pendingTxId={flow.state.pendingTxId}
        successLine="🎉 Done — fee accrued"
      />
    </>
  );
}
