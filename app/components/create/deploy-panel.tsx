"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  type TransactionSignature,
} from "@solana/web3.js";
import Link from "next/link";

import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useWalletFeedback } from "@/app/providers";
import { truncateAddress } from "@/lib/format";
import {
  GENESIS_SHARES,
  deriveCreateBasketPdas,
  estimateCreateBasketTxSize,
  fetchCreatorSeedBalances,
  listCreateBasketAccounts,
  validateCreateBasketArgs,
  type CreateBasketArgs,
} from "@/lib/create-basket";
import { RPC_ENDPOINT, describeRpcError, describeWalletError } from "@/lib/wallet";
import { withRetry } from "@/lib/rpc-retry";
// Sibling contract: shared helpers from the basket-group worker's lib.
import {
  buildCreateBasketTransaction,
  createBasketNeedsAlt,
  ensureCreateBasketAlt,
  explorerTxUrl,
} from "@/lib/transactions";
import {
  bpsToPct,
  feesLine,
  grouped,
  SummaryRow,
  TxSummaryCard,
} from "@/components/basket/summary-card";
import {
  hidePendingTx,
  removePendingTx,
  trackPendingTx,
  updatePendingTx,
} from "@/components/feedback/pending-tx";
import { formatRawAsTokenUnits, type ConstituentDraft } from "./types";

/** Uint8Array to lowercase hex (metadata hash display). */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type DeployPhase =
  | "idle"
  | "preparing-alt"
  | "simulating"
  | "simulation-failed"
  | "awaiting-wallet"
  | "pending"
  | "confirmed"
  | "failed"
  | "rejected";

const PACKET_LIMIT = 1232;

/** Shown on every close affordance AFTER the transaction has been sent. */
const HIDE_TOOLTIP = "Transaction already sent — closing won't stop it";

export interface DeployPanelProps {
  constituents: ConstituentDraft[];
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  nonce: number;
  metadataJson: string;
  metadataHash: Uint8Array;
  connected: boolean;
  publicKey: PublicKey | null;
  connection: Connection;
  sendTransaction: <T extends VersionedTransaction>(
    transaction: T,
    connection: Connection,
  ) => Promise<TransactionSignature>;
  onNonceRegenerate: () => void;
}

/**
 * Step 6 — ONE press. The primary button does everything: it pre-checks the
 * transaction on-chain (silent simulation through the shared retry loop), and
 * only if the check passes does the wallet open for the single approval. The
 * review modal speaks human ("You deposit / You get / Fees"); every account,
 * argument and program log lives in the collapsed "Advanced details".
 * Nothing about the builder or retry semantics changed — presentation only.
 */
export function DeployPanel({
  constituents,
  entryFeeBps,
  exitFeeBps,
  managementFeeBps,
  nonce,
  metadataJson,
  metadataHash,
  connected,
  publicKey,
  connection,
  sendTransaction,
  onNonceRegenerate,
}: DeployPanelProps) {
  const { reportError } = useWalletFeedback();
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [simulationLogs, setSimulationLogs] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [signature, setSignature] = useState<TransactionSignature | null>(null);
  const [balances, setBalances] = useState<Map<string, bigint | null> | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const pendingTxIdRef = useRef<string | null>(null);

  const creator = publicKey?.toBase58() ?? null;
  const args: CreateBasketArgs | null = creator
    ? {
        nonce,
        constituents: constituents.map((c) => c.mint),
        weightsBps: constituents.map((c) => c.weightBps),
        entryFeeBps,
        exitFeeBps,
        managementFeeBps,
        metadataHash,
        seedAmounts: constituents.map((c) => c.seedRaw),
      }
    : null;

  const validationErrors = args ? validateCreateBasketArgs(args) : [];
  const accountList =
    args && creator ? listCreateBasketAccounts(creator, args, constituents.map((c) => c.ticker)) : [];
  const pda = args && creator ? deriveCreateBasketPdas(creator, args) : null;
  const estSize = constituents.length > 0 ? estimateCreateBasketTxSize(constituents.length) : 0;
  const overLimit = estSize > PACKET_LIMIT;

  const loadBalances = useCallback(async () => {
    if (!creator || constituents.length === 0) return;
    setBalancesLoading(true);
    try {
      const values = await fetchCreatorSeedBalances(
        connection,
        creator,
        constituents.map((c) => c.mint),
      );
      const map = new Map<string, bigint | null>();
      constituents.forEach((c, i) => map.set(c.mint, values[i]));
      setBalances(map);
    } finally {
      setBalancesLoading(false);
    }
  }, [connection, creator, constituents]);

  // Balances (for the seed shortfall check) load when the review opens — no
  // simulation press required anymore.
  useEffect(() => {
    if (reviewOpen) void loadBalances();
  }, [reviewOpen, loadBalances]);

  // Escape mirrors the ✕: Cancel before the tx is sent, Hide afterwards.
  // Focus is trapped inside (aria-modal) and restored to the trigger on close.
  useEffect(() => {
    if (!reviewOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
      if (event.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === dialogRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [reviewOpen]);

  const shortfalls =
    balances === null
      ? []
      : constituents.filter((c) => {
          const balance = balances.get(c.mint);
          return balance === null || balance === undefined || balance < c.seedRaw;
        });

  // n >= 4 constituents exceed the 1232B packet limit, so the transaction is
  // compiled through an Address Lookup Table. Creating/extending that table
  // needs wallet signatures — `ensureAlt` asks once, then the table address is
  // reused for the rest of the session.
  const altRef = useRef<PublicKey | null>(null);
  const [altAddress, setAltAddress] = useState<string | null>(null);
  const [setupProgress, setSetupProgress] = useState<{ step: number; total: number } | null>(null);
  const needsAlt = args ? createBasketNeedsAlt(args.constituents.length) : false;

  const ensureAlt = useCallback(
    async (resumePhase: DeployPhase): Promise<PublicKey | null> => {
      if (!args || !creator || !createBasketNeedsAlt(args.constituents.length)) return null;
      if (altRef.current) return altRef.current;
      const handle = await ensureCreateBasketAlt({
        connection,
        creator,
        args,
        sendTransaction,
        onProgress: (step, total) => setSetupProgress({ step, total }),
        onAwaitingWallet: (awaiting) => setPhase(awaiting ? "preparing-alt" : resumePhase),
      });
      altRef.current = handle.lookupTableAddress;
      setAltAddress(handle.lookupTableAddress.toBase58());
      return handle.lookupTableAddress;
    },
    [args, creator, connection, sendTransaction],
  );

  const buildVersionedTransaction = useCallback(
    async (resumePhase: DeployPhase = "awaiting-wallet") => {
      if (!args || !creator) return null;
      const alt = await ensureAlt(resumePhase);
      const built = await buildCreateBasketTransaction({
        connection,
        creator,
        args,
        lookupTableAddresses: alt ? [alt] : [],
      });
      return built;
    },
    [args, creator, connection, ensureAlt],
  );

  // After a signature exists the tx is unstoppable: closing only hides the UI
  // and the page-level banner reports the outcome (owner's #1 complaint).
  const sent = signature !== null;
  const handleClose = useCallback(() => {
    // Hiding mid-flight (wallet prompt open) arms the banner so a late
    // approval still reports; post-send the banner takes over immediately.
    if (pendingTxIdRef.current) hidePendingTx(pendingTxIdRef.current);
    setReviewOpen(false);
    // Reset the local flow only while nothing was sent; otherwise the
    // confirmation keeps running under the banner.
    if (!sent) {
      setPhase("idle");
      setErrorMessage(null);
    }
  }, [sent]);

  /**
   * ONE press: auto-simulate (silent pre-flight with the shared retry loop);
   * a failed check shows the plain error inline and never opens the wallet; a
   * passing check goes straight to the wallet signature, then tracks the
   * confirmation in the page-level banner registry.
   */
  const deploy = useCallback(async () => {
    if (!args || !creator || !pda) return;
    setErrorMessage(null);
    setSimulationLogs([]);
    setPhase("simulating");
    // Pre-arm the banner registry: empty signature until the tx really lands
    // on-cluster; removed outright if we fail before that.
    const registryId = trackPendingTx({
      kind: "create",
      label: "basket creation",
      signature: "",
      endpoint: RPC_ENDPOINT,
      successLine: "🎉 Basket created!",
      actionHref: `/basket/${pda.basket.toBase58()}`,
      actionLabel: "View basket",
    });
    pendingTxIdRef.current = registryId;
    const dropEntry = () => {
      removePendingTx(registryId);
      pendingTxIdRef.current = null;
    };
    let built: Awaited<ReturnType<typeof buildVersionedTransaction>> = null;
    try {
      built = await buildVersionedTransaction("simulating");
    } catch (error) {
      dropEntry();
      setErrorMessage(
        `Deployment could not start: ${describeRpcError(error)} Nothing was signed — press Deploy basket to try again.`,
      );
      setPhase("simulation-failed");
      return;
    }
    if (!built) {
      dropEntry();
      return;
    }

    try {
      const result = await withRetry(
        () =>
          connection.simulateTransaction(built!.transaction, {
            sigVerify: false,
            replaceRecentBlockhash: true,
          }),
        { label: "create_basket simulation" },
      );
      if (result.value.err) {
        setSimulationLogs(result.value.logs ?? []);
        dropEntry();
        setErrorMessage(
          `The on-chain check failed: ${JSON.stringify(result.value.err)}. Your wallet was never opened — fix the inputs and press Deploy basket again.`,
        );
        setPhase("simulation-failed");
        return;
      }
      setSimulationLogs(result.value.logs ?? []);
      void loadBalances();
    } catch (error) {
      // Typed retry copy: after the withRetry loop (6 attempts, 2s→4s→8s→16s→30s)
      // the honest message names what failed and the next action.
      dropEntry();
      setErrorMessage(
        `The pre-flight check could not run: ${describeRpcError(error)} Nothing was signed — press Deploy basket to try again.`,
      );
      setPhase("simulation-failed");
      return;
    }

    // Pre-flight passed → straight to the wallet. One press from the user.
    setPhase("awaiting-wallet");
    try {
      // Re-sending is safe: an identical transaction (same blockhash +
      // signatures) dedups on-cluster by signature.
      const txSignature = await withRetry(
        () => sendTransaction(built!.transaction, connection),
        { label: "create_basket send" },
      );
      setSignature(txSignature);
      setPhase("pending");
      // Sent: the pre-armed banner entry becomes a real, unstoppable tx.
      updatePendingTx(registryId, { signature: txSignature });
      const confirmation = await withRetry(
        () =>
          connection.confirmTransaction(
            {
              blockhash: built!.blockhash,
              lastValidBlockHeight: built!.lastValidBlockHeight,
              signature: txSignature,
            },
            "confirmed",
          ),
        { label: "create_basket confirm" },
      );
      if (confirmation.value.err) {
        updatePendingTx(registryId, { status: "failed" });
        setErrorMessage(
          `Transaction ${txSignature} confirmed with an error: ${JSON.stringify(confirmation.value.err)}`,
        );
        setPhase("failed");
        return;
      }
      if (registryId) updatePendingTx(registryId, { status: "confirmed" });
      setPhase("confirmed");
    } catch (error) {
      if (registryId) updatePendingTx(registryId, { status: "failed" });
      const walletError = error as { name?: string; message?: string };
      const friendly = describeWalletError(walletError);
      if (friendly.toLowerCase().includes("reject")) {
        setErrorMessage(friendly);
        setPhase("rejected");
      } else {
        setErrorMessage(friendly);
        setPhase("failed");
      }
      reportError(walletError.name ?? "DeployError", friendly);
    }
  }, [args, creator, pda, buildVersionedTransaction, sendTransaction, connection, loadBalances, reportError]);

  if (!connected || !creator || !args || !pda) {
    return (
      <ErrorState
        title="Wallet not connected"
        message="Deploying signs a create_basket transaction from your wallet. Connect a wallet with the banner at the top of the wizard, then return to this step."
      />
    );
  }

  if (phase === "confirmed" && signature) {
    return (
      <div className="flex flex-col gap-4">
        <div
          role="status"
          data-testid="deploy-success-card"
          className="hairline-primary rounded-md border border-border bg-muted/30 p-5"
        >
          <p className="text-base font-semibold text-primary-text">🎉 Basket created!</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {GENESIS_SHARES.toLocaleString()} genesis shares are in your wallet — you&apos;re
            the creator and earn 90% of fees.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button render={<Link href={`/basket/${pda.basket.toBase58()}`} />} size="sm">
              View basket
            </Button>
            <a
              href={explorerTxUrl(signature, RPC_ENDPOINT)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center rounded-lg px-1 text-xs underline underline-offset-4 text-muted-foreground hover:text-foreground"
            >
              View on Explorer
            </a>
          </div>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Details</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1.5 font-mono text-xs tabular-nums sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Signature</dt>
            <dd className="break-all">{signature}</dd>
            <dt className="text-muted-foreground">Basket PDA</dt>
            <dd className="break-all">{pda.basket.toBase58()}</dd>
            <dt className="text-muted-foreground">Share mint</dt>
            <dd className="break-all">{pda.shareMint.toBase58()}</dd>
          </dl>
          <p className="mt-2">
            The basket is immutable; rankings, NAV and holdings appear once the indexer picks up
            the BasketCreated event.
          </p>
        </details>
      </div>
    );
  }

  const busy =
    phase === "simulating" ||
    phase === "preparing-alt" ||
    phase === "awaiting-wallet" ||
    phase === "pending";
  const blocked = validationErrors.length > 0;

  const busyLabel =
    phase === "simulating"
      ? "Checking on-chain…"
      : phase === "preparing-alt"
        ? "Setup in wallet…"
        : phase === "awaiting-wallet"
          ? "Approve in wallet…"
          : phase === "pending"
            ? "Confirming…"
            : "Deploy basket";

  // Human-language card inputs: whole-token deposits, integer percentages.
  const weightsLine = constituents
    .map((c) => `${c.ticker} ${Math.round(c.weightBps / 100)}%`)
    .join(" · ");
  const depositLine = constituents
    .map((c) => `${c.ticker} ${grouped(formatRawAsTokenUnits(c.seedRaw, c.decimals))}`)
    .join(" · ");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-5 text-muted-foreground">
        One press: we check the transaction on-chain first, then your wallet opens for a single
        approval. The basket is immutable once deployed.
      </p>

      {blocked && (
        <ErrorState
          title="Inputs invalid"
          message={validationErrors.join(" ")}
        />
      )}
      {overLimit && !blocked && (
        <p className="rounded-md border border-border/60 bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
          One-time setup: this basket is too large for one plain transaction (~
          {estSize.toLocaleString()} B), so the first deploy also creates a lookup table — you may
          approve 1–2 setup transactions, after which every deploy is a single click.
        </p>
      )}

      {phase === "rejected" && (
        <ErrorState
          title="Signature rejected"
          message={errorMessage ?? "The request was rejected in the wallet."}
        />
      )}
      {(phase === "failed" || phase === "simulation-failed") && (
        <ErrorState title="Deploy failed" message={errorMessage ?? undefined} />
      )}
      {phase === "pending" && signature && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm"
        >
          <span
            aria-hidden="true"
            className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
          />
          Confirming…
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => setReviewOpen(true)}
          disabled={blocked || busy}
          data-testid="deploy-trigger"
        >
          Deploy basket
        </Button>
        {signature && phase !== "pending" && (
          <a
            href={explorerTxUrl(signature, RPC_ENDPOINT)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            View last transaction
          </a>
        )}
      </div>

      {reviewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) handleClose();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deploy-review-title"
            tabIndex={-1}
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-5 outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="deploy-review-title" className="text-base font-semibold">
                  Create basket
                </h2>
                {phase === "preparing-alt" && setupProgress ? (
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

            {/* ---- the human-language card: the whole review ---- */}
            <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
              <TxSummaryCard>
                <SummaryRow label="New basket" value={weightsLine} />
                <SummaryRow label="You deposit" value={depositLine} />
                <SummaryRow
                  label="You get"
                  emphasis
                  value={`${GENESIS_SHARES.toLocaleString()} shares — you're the creator and earn 90% of fees`}
                />
                <SummaryRow
                  label="Fees"
                  muted
                  value={`${feesLine(entryFeeBps, exitFeeBps, managementFeeBps)} (90% supports the creator)`}
                />
              </TxSummaryCard>
            </div>

            {/* seed shortfall — the one blocking condition worth surfacing */}
            <section className="mt-3">
              {balancesLoading || balances === null ? (
                <p className="text-xs text-muted-foreground">Checking creator token balances…</p>
              ) : shortfalls.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {shortfalls.map((c) => {
                    const balance = balances.get(c.mint) ?? null;
                    return (
                      <li key={c.mint} className="font-mono text-xs text-destructive">
                        {c.ticker}: balance{" "}
                        {balance === null
                          ? "no token account"
                          : formatRawAsTokenUnits(balance, c.decimals)}{" "}
                        &lt; seed {formatRawAsTokenUnits(c.seedRaw, c.decimals)}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-primary-text">
                  ✓ All creator token balances cover the seed amounts.
                </p>
              )}
            </section>

            {(phase === "failed" || phase === "simulation-failed") && errorMessage ? (
              <p
                role="alert"
                className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs leading-5"
              >
                {errorMessage}
              </p>
            ) : null}

            {phase === "simulating" ? (
              <div role="status" className="mt-3 flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
                />
                Checking on-chain…
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
              <Button
                variant="outline"
                onClick={handleClose}
                title={sent ? HIDE_TOOLTIP : undefined}
                data-testid="tx-hide"
              >
                {sent ? "Hide" : "Cancel"}
              </Button>
              <Button
                type="button"
                onClick={deploy}
                disabled={busy || blocked || balances === null || shortfalls.length > 0}
                data-testid="tx-confirm"
              >
                {busy ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
                    />
                    {busyLabel}
                  </>
                ) : (
                  "Deploy basket"
                )}
              </Button>
            </div>
            <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
              Checked on-chain before signing — nothing is sent without your approval.
            </p>

            {/* ---- the engineers' view: every raw byte, one collapse away ---- */}
            <details className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">
                Advanced details — arguments, accounts ({accountList.length}), metadata
              </summary>
              <div className="mt-3 space-y-4">
                <dl className="grid gap-x-4 gap-y-1 font-mono tabular-nums sm:grid-cols-[auto_1fr]">
                  <dt>nonce (u64)</dt>
                  <dd className="flex items-center gap-2 break-all">
                    {nonce}
                    <button
                      type="button"
                      onClick={onNonceRegenerate}
                      disabled={busy}
                      className="rounded-sm px-1 underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      regenerate
                    </button>
                  </dd>
                  <dt>constituents (Vec&lt;Pubkey&gt;)</dt>
                  <dd className="break-all">{constituents.map((c) => c.mint).join(", ")}</dd>
                  <dt>weights_bps (Vec&lt;u16&gt;)</dt>
                  <dd>{constituents.map((c) => c.weightBps).join(", ")}</dd>
                  <dt>entry_fee_bps (u16)</dt>
                  <dd>{entryFeeBps}</dd>
                  <dt>exit_fee_bps (u16)</dt>
                  <dd>{exitFeeBps}</dd>
                  <dt>management_fee_bps (u16)</dt>
                  <dd>{managementFeeBps}</dd>
                  <dt>metadata_hash ([u8;32])</dt>
                  <dd className="break-all">{toHex(metadataHash)}</dd>
                  <dt>seed_amounts (Vec&lt;u64&gt;)</dt>
                  <dd className="break-all">
                    {constituents
                      .map((c) => `${c.seedRaw.toString()} (${c.ticker})`)
                      .join(", ")}
                  </dd>
                  <dt>Basket PDA</dt>
                  <dd className="break-all" title={pda.basket.toBase58()}>
                    {pda.basket.toBase58()}
                  </dd>
                  <dt>Share mint PDA</dt>
                  <dd className="break-all" title={pda.shareMint.toBase58()}>
                    {pda.shareMint.toBase58()}
                  </dd>
                  <dt>Vault authority</dt>
                  <dd className="break-all" title={pda.vaultAuthority.toBase58()}>
                    {pda.vaultAuthority.toBase58()}
                  </dd>
                  <dt>Est. tx size</dt>
                  <dd className="break-all">
                    ~{estSize.toLocaleString()} B
                    {overLimit
                      ? ` — exceeds the ${PACKET_LIMIT} B packet limit; sent through a lookup table`
                      : ""}
                  </dd>
                  {altAddress && (
                    <>
                      <dt>Lookup table</dt>
                      <dd className="break-all" title={altAddress}>
                        {altAddress}
                      </dd>
                    </>
                  )}
                </dl>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono font-medium uppercase tracking-[0.22em]">Metadata (hashed, not uploaded)</p>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(metadataJson).catch(() => {})}
                      className="rounded-sm px-1 underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      copy JSON
                    </button>
                  </div>
                  <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[11px] leading-4">
                    {metadataJson}
                  </pre>
                  <p className="mt-1 font-mono tabular-nums">
                    sha256 = {toHex(metadataHash)}
                  </p>
                  <p className="mt-1 leading-5">
                    Hashed with sha256 and stored on-chain — not uploaded. The hash is immutable;
                    publish the JSON yourself if you want it resolvable.
                  </p>
                </div>

                <div>
                  <p className="font-mono font-medium uppercase tracking-[0.22em]">
                    Accounts ({accountList.length}) — order exactly as serialized
                  </p>
                  <ol className="mt-1 flex flex-col gap-1">
                    {accountList.map((entry) => (
                      <li
                        key={entry.role}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md border border-border/60 bg-background px-2 py-1.5"
                      >
                        <span className="font-mono text-xs">{entry.role}</span>
                        <span className="flex min-w-0 items-center gap-2">
                          {entry.note && (
                            <span className="hidden text-[11px] sm:inline">{entry.note}</span>
                          )}
                          <span className="font-mono text-[11px] tabular-nums">
                            {entry.writable ? "mut" : "ro"}
                            {entry.signer ? " +signer" : ""}
                          </span>
                          <span
                            className="font-mono text-[11px] tabular-nums"
                            title={entry.pubkey}
                          >
                            {truncateAddress(entry.pubkey, 6, 6)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>

                {simulationLogs.length > 0 && (
                  <div>
                    <p className="font-mono font-medium uppercase tracking-[0.22em]">Last simulation log</p>
                    <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[11px] leading-4">
                      {simulationLogs.slice(-8).join("\n")}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
