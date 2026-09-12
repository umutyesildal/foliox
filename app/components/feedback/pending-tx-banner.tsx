"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { explorerTxUrl } from "@/lib/transactions";

import {
  dismissPendingTx,
  getPendingTxEntries,
  subscribePendingTx,
  type PendingTxEntry,
} from "./pending-tx";

/**
 * Page-level safety net for "tx sent, modal hidden": one quiet card pinned to
 * the bottom of ANY page while a sent transaction is still confirming, then
 * the outcome line for a few seconds ("Your buy is confirming on-chain… ✓
 * completed — view Portfolio"). The module registry (pending-tx.ts) is the
 * source of truth, so client-side navigation never orphans a confirmation.
 */
export function PendingTxBanner() {
  const [entries, setEntries] = useState<PendingTxEntry[]>(() =>
    getPendingTxEntries(),
  );

  useEffect(
    () => subscribePendingTx(() => setEntries(getPendingTxEntries())),
    [],
  );

  // Only entries whose modal was hidden surface here — an open modal already
  // shows the live state, and a dismissed pending line still flashes the
  // terminal outcome once it lands. Empty signature = pre-armed entry whose
  // transaction was never actually sent → never shown.
  const visible = entries.filter(
    (entry) =>
      entry.signature !== "" &&
      entry.hidden &&
      (entry.status !== "pending" || !entry.dismissed),
  );

  if (visible.length === 0) return null;

  return (
    <div
      data-testid="pending-tx-banner-region"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-2 px-4"
    >
      {visible.map((entry) => (
        <PendingTxCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function PendingTxCard({ entry }: { entry: PendingTxEntry }) {
  const explorerHref = entry.endpoint
    ? explorerTxUrl(entry.signature, entry.endpoint)
    : null;
  const done = entry.status === "confirmed";
  const failed = entry.status === "failed";

  const line =
    entry.status === "pending"
      ? `Your ${entry.label} is confirming on-chain…`
      : entry.status === "submitted"
        ? `Your ${entry.label} was sent — still confirming…`
        : done
          ? entry.successLine ?? `✓ Your ${entry.label} completed`
          : `Your ${entry.label} failed — funds are safe.`;

  return (
    <div
      role="status"
      data-testid="pending-tx-banner"
      className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg border border-border bg-card p-3"
    >
      {entry.status === "pending" ? (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
        />
      ) : (
        <span
          aria-hidden="true"
          className="w-4 shrink-0 text-center text-base leading-none"
        >
          {failed ? "✕" : "✓"}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{line}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {entry.actionHref && entry.actionLabel ? (
            <Link
              href={entry.actionHref}
              data-testid="pending-tx-banner-action"
              className="underline underline-offset-4 hover:text-foreground"
            >
              {entry.actionLabel}
            </Link>
          ) : null}
          {explorerHref ? (
            <a
              href={explorerHref}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              View on Explorer
            </a>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        data-testid="pending-tx-banner-dismiss"
        aria-label="Dismiss"
        onClick={() => dismissPendingTx(entry.id)}
        className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        ✕
      </button>
    </div>
  );
}
