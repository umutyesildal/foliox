"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/format";
import type { ExpectedAccount } from "@/lib/transactions";
import { explorerTxUrl } from "@/lib/transactions";
import { hidePendingTx } from "@/components/feedback/pending-tx";
import type { TransactionFlowState } from "@/components/basket/use-transaction-flow";
import type { SetupProgress } from "@/components/basket/use-alt-prewarm";

/** Shown on every close affordance AFTER the transaction has been sent. */
const HIDE_TOOLTIP = "Transaction already sent — closing won't stop it";

/**
 * Transaction review modal: human-language summary + a compact 3-state result
 * card. ONE primary action per state.
 *
 * Copy contract (≤ 2 sentences per state, no walls of text):
 *  - PENDING   spinner + one line ("Confirming…"); lookup-table setup is
 *              labelled as such in the header ("Setup 1/2").
 *  - SENT      big ✓ pending style + ONE explorer link + one "few seconds"
 *              reassurance line. Never an error, never a paragraph.
 *  - SUCCESS   "🎉 Done — +X shares of <BASKET>" (or −X / "Basket created!")
 *              + [View Portfolio] [View on Explorer].
 *  - FAILURE   one plain sentence + Retry; the technical log hides behind a
 *              collapsed "Details" disclosure.
 * Close semantics: BEFORE the wallet signs → "Cancel" aborts truly (local
 * state resets, nothing is on-chain). AFTER the tx is sent → every close
 * affordance becomes "Hide" (tooltip: "Transaction already sent — closing
 * won't stop it"); the confirmation keeps running and the page-level banner
 * (components/feedback) reports the outcome.
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
  onRetry,
  confirmLabel,
  endpoint,
  errorSlot,
  successLine,
  successExtra,
  portfolioHref = "/portfolio",
  setupProgress = null,
  pendingTxId = null,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  accounts: ExpectedAccount[];
  summary?: ReactNode;
  flowState: TransactionFlowState;
  onConfirm: () => void;
  /** Resumes from the failed step (re-runs the same build/prepare). */
  onRetry?: () => void;
  confirmLabel: string;
  /** RPC endpoint for cluster-aware explorer links. */
  endpoint: string;
  /** Extra inline alert rendered above the actions (e.g. MintPaused explainer). */
  errorSlot?: ReactNode;
  /** SUCCESS headline, e.g. "🎉 Done — +12.5 shares of ROMAN" (or null for default). */
  successLine?: ReactNode;
  /** Extra content inside the SUCCESS card (e.g. the "Share your thesis" CTA). */
  successExtra?: ReactNode;
  /** Where "View Portfolio" points (create flows may link elsewhere). */
  portfolioHref?: string;
  /** Live lookup-table setup progress → "Setup 1/2" badge in the header. */
  setupProgress?: SetupProgress | null;
  /** Registry id from use-transaction-flow — enables the "Hide" semantics. */
  pendingTxId?: string | null;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // After a signature exists the tx is unstoppable: closing only hides the UI,
  // and the still-running confirmation surfaces via the page-level banner.
  const sent = flowState.signature !== null && !isIdle(flowState.status);
  const flowAlive = !isIdle(flowState.status) && !isTerminal(flowState.status);
  const handleClose = () => {
    // Pre-send (wallet prompt open) → hiding arms the banner so a late
    // approval still reports; post-send → the banner takes over immediately.
    if (pendingTxId && (sent || flowAlive)) hidePendingTx(pendingTxId);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape mirrors the ✕: Cancel while idle, Hide once the tx is sent.
      if (event.key === "Escape") handleClose();
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
    // handleClose is a plain closure over (sent, pendingTxId, onClose).
  }, [open, sent, pendingTxId, onClose, flowState.status]);

  if (!open) return null;

  const inFlight = flowAlive;
  const terminal = isTerminal(flowState.status);
  const explorerHref = flowState.signature
    ? explorerTxUrl(flowState.signature, endpoint)
    : null;
  // Retry only when the failure was transient (the flow marks deterministic
  // program errors non-retryable — re-running would fail identically).
  const canRetry =
    Boolean(onRetry) &&
    (flowState.status === "failed" || flowState.status === "rejected") &&
    flowState.retryable;

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
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-card p-5 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            {flowState.status === "preparing-alt" && setupProgress ? (
              <span
                data-testid="setup-badge"
                className="rounded-sm border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
              >
                Setup {setupProgress.step}/{setupProgress.total}
              </span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={sent ? "Hide" : "Cancel"}
            title={sent ? HIDE_TOOLTIP : "Cancel"}
            data-testid="tx-close"
            onClick={handleClose}
          >
            ×
          </Button>
        </div>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        ) : null}

        {summary ? (
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
            {summary}
          </div>
        ) : null}

        {errorSlot}

        <div aria-live="polite" className="mt-4">
          <StatusCard
            state={flowState}
            explorerHref={explorerHref}
            successLine={successLine}
            successExtra={successExtra}
            portfolioHref={portfolioHref}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {canRetry ? <Button variant="outline" onClick={onRetry}>Retry</Button> : null}
          {/* One close affordance, two honest verbs: Cancel (before the wallet
              signs — aborts truly) / Hide (after send — the banner takes over). */}
          <Button
            variant="outline"
            onClick={handleClose}
            title={sent ? HIDE_TOOLTIP : undefined}
            data-testid="tx-hide"
          >
            {sent ? "Hide" : "Cancel"}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={inFlight || terminal || !isIdle(flowState.status)}
            data-testid="tx-confirm"
          >
            {inFlight ? (
              <>
                <Spinner />
                {statusLabel(flowState.status)}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>

        {accounts.length > 0 ? (
          <details className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">
              Advanced details — accounts this transaction touches ({accounts.length})
            </summary>
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-md border border-border">
              {accounts.map((account) => (
                <li key={`${account.label}-${account.pubkey.toBase58()}`} className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                    <span className="font-mono text-xs font-medium text-foreground">{account.label}</span>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {truncateAddress(account.pubkey.toBase58(), 6, 6)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className="text-[11px] leading-4 text-muted-foreground">{account.note}</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80">
                      {account.signer ? "signer " : ""}
                      {account.writable ? "writable" : "read-only"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function isIdle(status: TransactionFlowState["status"]): boolean {
  return status === "idle";
}

function isTerminal(status: TransactionFlowState["status"]): boolean {
  return (
    status === "confirmed" ||
    // Sent-and-pending is also a settled outcome for the modal (not in-flight):
    // it renders the explorer link and never re-enables the sign button.
    status === "submitted" ||
    status === "failed" ||
    status === "rejected"
  );
}

function statusLabel(status: TransactionFlowState["status"]): string {
  switch (status) {
    case "preparing-alt":
      return "Setup in wallet…";
    case "simulating":
      // Auto pre-flight: the user never pressed "Simulate" — say what the
      // machine is doing in plain words, not engineer words.
      return "Checking on-chain…";
    case "awaiting-signature":
      return "Approve in wallet…";
    case "confirming":
      return "Confirming…";
    default:
      return "";
  }
}

/** One plain sentence for a failure — no codes, no multi-clause paragraphs. */
function shortReason(state: TransactionFlowState): string {
  const raw = (state.error ?? "").trim();
  if (raw.length <= 140) return raw.replace(/\.$/, "");
  const cut = raw.slice(0, 140);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("—"));
  return (lastStop > 40 ? cut.slice(0, lastStop) : cut).trim();
}

/** Spinner: pure CSS, no icon dependency. */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
    />
  );
}

function StatusCard({
  state,
  explorerHref,
  successLine,
  successExtra,
  portfolioHref,
}: {
  state: TransactionFlowState;
  explorerHref: string | null;
  successLine?: ReactNode;
  successExtra?: ReactNode;
  portfolioHref: string;
}) {
  switch (state.status) {
    case "idle":
      return (
        <p className="text-xs text-muted-foreground">
          Checked on-chain before signing — nothing is sent without your approval.
        </p>
      );

    case "preparing-alt":
    case "simulating":
    case "awaiting-signature":
    case "confirming":
      // PENDING: spinner + ONE line. Setup phases are labelled as one-time
      // setup, never as a mysterious second approval.
      return (
        <div role="status" data-testid="tx-status-card" className="space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Spinner />
            {state.status === "preparing-alt"
              ? "Preparing your basket account… one-time setup"
              : "Sending your transaction…"}
          </p>
          {state.progress ? (
            <p className="text-xs text-muted-foreground">
              Network is busy — retrying automatically…
            </p>
          ) : null}
        </div>
      );

    case "confirmed":
      // SUCCESS: confirmed-on-chain reads through the yellow system (hairline
      // + headline); the delta/amount inside the headline keeps its semantic
      // green via the caller. The delta in plain language + the two useful
      // actions.
      return (
        <div
          role="status"
          data-testid="tx-status-card"
          className="hairline-primary rounded-md border border-border bg-muted/30 p-3"
        >
          <p className="text-sm font-semibold text-primary-text">{successLine ?? "🎉 Done"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button render={<Link href={portfolioHref} />} size="sm">
              View Portfolio
            </Button>
            {explorerHref ? (
              <a
                href={explorerHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm hover:bg-muted"
              >
                View on Explorer
              </a>
            ) : null}
          </div>
          {successExtra ? (
            <div className="mt-3 border-t border-border/60 pt-3">{successExtra}</div>
          ) : null}
        </div>
      );

    case "submitted":
      // SENT: big ✓ pending style — the send landed, confirmation is only
      // catching up. One link, one reassurance line, zero paragraphs.
      return (
        <div
          role="status"
          data-testid="tx-status-card"
          className="rounded-md border border-border bg-muted/30 p-3"
        >
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden="true" className="text-lg leading-none">✓</span>
            Sent! Confirming on-chain…
          </p>
          {explorerHref ? (
            <a
              href={explorerHref}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs underline underline-offset-4 hover:text-foreground"
            >
              View on Explorer
            </a>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            You&apos;ll see it in your Portfolio in a few seconds.
          </p>
        </div>
      );

    case "rejected":
      return (
        <div role="alert" data-testid="tx-status-card" className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-sm">Not signed — nothing moved. You cancelled in your wallet.</p>
        </div>
      );

    case "failed":
      // FAILURE: one plain sentence + Retry; the technical report collapses.
      return (
        <div
          role="alert"
          data-testid="tx-status-card"
          className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3"
        >
          <p className="text-sm">
            The network rejected the trade: {shortReason(state)}. Nothing was lost — try again.
          </p>
          <details className="text-[11px] leading-4 text-muted-foreground">
            <summary className="cursor-pointer select-none">Details</summary>
            <div className="mt-1 space-y-2">
              {state.error ? <p>{state.error}</p> : null}
              {state.approvedEarlier ? (
                <p>
                  Everything approved so far is already on-chain — Retry continues from where it
                  stopped without re-asking those approvals.
                </p>
              ) : null}
              {explorerHref ? (
                <a
                  href={explorerHref}
                  target="_blank"
                  rel="noreferrer"
                  className="block font-mono tabular-nums underline underline-offset-4 hover:text-foreground"
                >
                  View transaction {state.signature?.slice(0, 16)}… on Solana Explorer
                </a>
              ) : null}
              {state.logs.length > 0 ? (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono">
                  {state.logs.join("\n")}
                </pre>
              ) : null}
            </div>
          </details>
        </div>
      );
  }
}
