"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/format";
import type { ExpectedAccount } from "@/lib/transactions";
import { explorerTxUrl } from "@/lib/transactions";
import type { TransactionFlowState } from "@/components/basket/use-transaction-flow";

/**
 * Transaction review modal. Lists EVERY account the transaction will touch
 * (from the builder's expectedAccounts) plus a summary slot, then drives the
 * simulate → sign → confirm states. Escape closes while idle only — closing is
 * disabled mid-flight so the outcome state is always visible.
 */
export function TxReviewModal({
  open,
  onClose,
  title,
  description,
  accounts,
  summary,
  flowState,
  onConfirm,
  confirmLabel,
  endpoint,
  errorSlot,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  accounts: ExpectedAccount[];
  summary?: ReactNode;
  flowState: TransactionFlowState;
  onConfirm: () => void;
  confirmLabel: string;
  /** RPC endpoint for cluster-aware explorer links. */
  endpoint: string;
  /** Extra inline alert rendered above the actions (e.g. MintPaused explainer). */
  errorSlot?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isIdle(flowState.status)) onClose();
      // Focus trap: with aria-modal set, Tab must cycle inside the dialog.
      if (event.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === panelRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open, onClose, flowState.status]);

  if (!open) return null;

  const inFlight = !isIdle(flowState.status) && !isTerminal(flowState.status);
  const terminal = isTerminal(flowState.status);
  const explorerHref = flowState.signature
    ? explorerTxUrl(flowState.signature, endpoint)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-4 backdrop-blur-[2px] sm:items-center"
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close review"
            onClick={onClose}
            disabled={inFlight}
          >
            ×
          </Button>
        </div>

        {summary ? (
          <div className="mt-5 rounded-md border border-border bg-muted/30 p-3 text-sm">
            {summary}
          </div>
        ) : null}

        <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Accounts this transaction touches ({accounts.length})
        </h3>
        <ul className="mt-2 divide-y divide-border overflow-hidden rounded-md border border-border">
          {accounts.map((account) => (
            <li key={`${account.label}-${account.pubkey.toBase58()}`} className="px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <span className="font-mono text-xs font-medium">{account.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {truncateAddress(account.pubkey.toBase58(), 6, 6)}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-[11px] leading-4 text-muted-foreground">{account.note}</p>
                <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
                  {account.signer ? "signer " : ""}
                  {account.writable ? "writable" : "read-only"}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {errorSlot}

        <div aria-live="polite" className="mt-5">
          <StatusLine state={flowState} explorerHref={explorerHref} />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={inFlight}>
            {terminal ? "Close" : "Cancel"}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={inFlight || terminal || !isIdle(flowState.status)}
          >
            {inFlight ? statusLabel(flowState.status) : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function isIdle(status: TransactionFlowState["status"]): boolean {
  return status === "idle";
}

function isTerminal(status: TransactionFlowState["status"]): boolean {
  return status === "confirmed" || status === "failed" || status === "rejected";
}

function statusLabel(status: TransactionFlowState["status"]): string {
  switch (status) {
    case "simulating":
      return "Simulating…";
    case "awaiting-signature":
      return "Approve in your wallet…";
    case "confirming":
      return "Confirming…";
    default:
      return "";
  }
}

function StatusLine({
  state,
  explorerHref,
}: {
  state: TransactionFlowState;
  explorerHref: string | null;
}) {
  switch (state.status) {
    case "idle":
      return (
        <p className="text-xs text-muted-foreground">
          Simulation runs first — nothing is signed until the simulation passes.
        </p>
      );
    case "simulating":
    case "awaiting-signature":
    case "confirming":
      return (
        <p role="status" className="font-mono text-xs tabular-nums text-muted-foreground">
          {statusLabel(state.status)}
        </p>
      );
    case "confirmed":
      return (
        <div role="status" className="space-y-1">
          <p className="text-xs font-medium text-foreground">Confirmed.</p>
          {explorerHref ? (
            <a
              href={explorerHref}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs tabular-nums underline underline-offset-4 hover:text-foreground"
            >
              View transaction on Solana Explorer
            </a>
          ) : null}
        </div>
      );
    case "rejected":
      return (
        <div role="alert" className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium">Not signed</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{state.error}</p>
        </div>
      );
    case "failed":
      return (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3"
        >
          <p className="text-xs font-medium text-destructive">{state.error}</p>
          {state.logs.length > 0 ? (
            <details className="text-[11px] leading-4 text-muted-foreground">
              <summary className="cursor-pointer select-none">Program logs</summary>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                {state.logs.join("\n")}
              </pre>
            </details>
          ) : null}
        </div>
      );
  }
}

