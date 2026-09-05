/**
 * Module-level registry of transactions that have been SENT and are still
 * confirming — the safety net for "user closed the modal while the tx was in
 * flight" (the owner's #1 complaint: the flow must not die silently).
 *
 * The originating flow (use-transaction-flow / deploy panel) registers an
 * entry the moment a signature exists; the page-level banner reads the
 * registry, so the outcome stays visible on ANY page in the app across
 * client-side navigation. Plain data, no React: flows write, banner subscribes.
 *
 * Lifecycle: trackPendingTx (sent) → hidden (modal closed) → terminal status
 * (confirmed/submitted/failed) → the outcome line stays up a few seconds, then
 * the banner cleans up after itself — no permanent chrome, no dead entries.
 */

export type PendingTxKind = "buy" | "redeem" | "create" | "crank";

export type PendingTxStatus = "pending" | "submitted" | "confirmed" | "failed";

export interface PendingTxEntry {
  id: string;
  kind: PendingTxKind;
  /** Banner noun, lowercase: "buy", "redeem", "basket creation". */
  label: string;
  signature: string;
  /** RPC endpoint → cluster-aware explorer link (lib/wallet). */
  endpoint: string | null;
  /** SUCCESS headline, e.g. "🎉 Done — +2,475 shares". */
  successLine: string | null;
  /** Where the outcome action link points (e.g. "/portfolio"). */
  actionHref: string | null;
  /** Outcome action label, e.g. "View Portfolio". */
  actionLabel: string | null;
  status: PendingTxStatus;
  /** True once the originating modal was closed while the flow was alive. */
  hidden: boolean;
  /** True once the user dismissed the pending banner (outcome still flashes). */
  dismissed: boolean;
}

export type PendingTxPatch = Partial<Omit<PendingTxEntry, "id">>;

/** How long a terminal outcome line stays visible before auto-removal. */
const OUTCOME_TTL_MS = 8_000;

const entries = new Map<string, PendingTxEntry>();
const listeners = new Set<() => void>();
const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();

let counter = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Register a flow. `signature` starts empty (pre-arm, before the wallet
 * signs) and is patched in the moment the transaction is actually sent — the
 * banner only ever shows transactions that were really sent. Returns the id
 * used by the update/hide calls.
 */
export function trackPendingTx(init: {
  kind: PendingTxKind;
  label: string;
  signature: string;
  endpoint?: string | null;
  successLine?: string | null;
  actionHref?: string | null;
  actionLabel?: string | null;
}): string {
  const id = `ptx-${Date.now().toString(36)}-${(counter += 1)}`;
  entries.set(id, {
    id,
    kind: init.kind,
    label: init.label,
    signature: init.signature,
    endpoint: init.endpoint ?? null,
    successLine: init.successLine ?? null,
    actionHref: init.actionHref ?? null,
    actionLabel: init.actionLabel ?? null,
    status: "pending",
    hidden: false,
    dismissed: false,
  });
  emit();
  return id;
}

/** Move an entry forward (signature patch-in on send, status changes, …). */
export function updatePendingTx(id: string, patch: PendingTxPatch): void {
  const entry = entries.get(id);
  if (!entry) return;
  entries.set(id, { ...entry, ...patch });
  if (
    (patch.status === "confirmed" ||
      patch.status === "failed" ||
      patch.status === "submitted") &&
    !removalTimers.has(id)
  ) {
    if (entry.signature === "" && !patch.signature) {
      // Terminal without ever being sent (wallet rejected / pre-flight
      // failed) — nothing for the banner to report, clean up at once.
      entries.delete(id);
      emit();
      return;
    }
    // The outcome line stays up a few seconds, then the banner cleans up
    // after itself — no permanent chrome, no dead entries.
    removalTimers.set(
      id,
      setTimeout(() => {
        removalTimers.delete(id);
        entries.delete(id);
        emit();
      }, OUTCOME_TTL_MS),
    );
  }
  emit();
}

/** Drop an entry outright (pre-send failure paths). */
export function removePendingTx(id: string): void {
  const timer = removalTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    removalTimers.delete(id);
  }
  if (entries.delete(id)) emit();
}

/** The originating modal closed while the flow is alive → the banner takes over. */
export function hidePendingTx(id: string): void {
  const entry = entries.get(id);
  if (!entry || entry.hidden) return;
  entries.set(id, { ...entry, hidden: true });
  emit();
}

/** User dismissed the pending banner; the terminal outcome still flashes. */
export function dismissPendingTx(id: string): void {
  const entry = entries.get(id);
  if (!entry || entry.dismissed) return;
  entries.set(id, { ...entry, dismissed: true });
  emit();
}

export function getPendingTxEntries(): PendingTxEntry[] {
  return Array.from(entries.values());
}

export function subscribePendingTx(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
