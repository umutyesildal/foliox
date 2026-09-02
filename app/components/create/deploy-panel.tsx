"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionSignature,
} from "@solana/web3.js";
import Link from "next/link";

import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { useWalletFeedback } from "@/app/providers";
import { formatBps, truncateAddress } from "@/lib/format";
import {
  GENESIS_SHARES,
  buildCreateBasketInstruction,
  deriveCreateBasketPdas,
  estimateCreateBasketTxSize,
  fetchCreatorSeedBalances,
  listCreateBasketAccounts,
  validateCreateBasketArgs,
  type CreateBasketArgs,
} from "@/lib/create-basket";
import { RPC_ENDPOINT, describeWalletError } from "@/lib/wallet";
// Sibling contract: shared helpers from the basket-group worker's lib.
import { explorerTxUrl } from "@/lib/transactions";
import { formatRawAsTokenUnits, type ConstituentDraft } from "./types";

/** Uint8Array to lowercase hex (metadata hash display). */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type DeployPhase =
  | "idle"
  | "simulating"
  | "simulation-failed"
  | "awaiting-wallet"
  | "pending"
  | "confirmed"
  | "failed"
  | "rejected";

const PACKET_LIMIT = 1232;

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
 * Step 6 — review every account and argument, simulate, sign, and track the
 * deploy through pending / confirmed / failed / rejected with an explorer
 * link. Nothing is hidden: the account list comes from the same builder that
 * serializes the instruction.
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

  // Escape closes the review modal while no signing is in flight. Focus is
  // trapped inside (aria-modal) and restored to the trigger on close.
  useEffect(() => {
    if (!reviewOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "awaiting-wallet" && phase !== "pending") {
        setReviewOpen(false);
      }
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
  }, [reviewOpen, phase]);

  const shortfalls =
    balances === null
      ? []
      : constituents.filter((c) => {
          const balance = balances.get(c.mint);
          return balance === null || balance === undefined || balance < c.seedRaw;
        });

  const buildVersionedTransaction = useCallback(async () => {
    if (!args || !creator) return null;
    const instruction = buildCreateBasketInstruction(creator, args);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: new PublicKey(creator),
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message([]);
    const tx = new VersionedTransaction(message);
    return { tx, blockhash, lastValidBlockHeight };
  }, [args, creator, connection]);

  const runSimulation = useCallback(async () => {
    if (!args || !creator) return;
    setPhase("simulating");
    setSimulationLogs([]);
    setErrorMessage(null);
    try {
      const built = await buildVersionedTransaction();
      if (!built) return;
      const result = await connection.simulateTransaction(built.tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      if (result.value.err) {
        setSimulationLogs(result.value.logs ?? []);
        setErrorMessage(
          `Simulation reverted: ${JSON.stringify(result.value.err)}. Fix the inputs or check RPC state.`,
        );
        setPhase("simulation-failed");
        return;
      }
      setSimulationLogs(result.value.logs ?? []);
      setPhase("idle");
      await loadBalances();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`Simulation failed to run: ${message}`);
      setPhase("simulation-failed");
    }
  }, [args, creator, buildVersionedTransaction, connection, loadBalances]);

  const deploy = useCallback(async () => {
    if (!args || !creator) return;
    setErrorMessage(null);
    setPhase("awaiting-wallet");
    try {
      const built = await buildVersionedTransaction();
      if (!built) return;
      const txSignature = await sendTransaction(built.tx, connection);
      setSignature(txSignature);
      setPhase("pending");
      const confirmation = await connection.confirmTransaction(
        {
          blockhash: built.blockhash,
          lastValidBlockHeight: built.lastValidBlockHeight,
          signature: txSignature,
        },
        "confirmed",
      );
      if (confirmation.value.err) {
        setErrorMessage(
          `Transaction ${txSignature} confirmed with an error: ${JSON.stringify(confirmation.value.err)}`,
        );
        setPhase("failed");
        return;
      }
      setPhase("confirmed");
    } catch (error) {
      const walletError = error as { name?: string; message?: string };
      const friendly = describeWalletError(walletError);
      if (friendly.toLowerCase().includes("reject")) {
        setErrorMessage(friendly);
        setPhase("rejected");
      } else {
        setErrorMessage(friendly);
        setPhase("failed");
      }
      reportError(walletError?.name ?? "DeployError", friendly);
    }
  }, [args, creator, buildVersionedTransaction, sendTransaction, connection, reportError]);

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
        <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
          <p className="text-sm font-medium">Basket deployed</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            create_basket confirmed. Genesis {GENESIS_SHARES.toLocaleString()} shares were minted
            to your wallet; the mint authority now belongs to the basket program&apos;s vault
            authority PDA.
          </p>
        </div>
        <dl className="grid gap-x-4 gap-y-1.5 font-mono text-xs tabular-nums sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Signature</dt>
          <dd className="break-all">{signature}</dd>
          <dt className="text-muted-foreground">Basket PDA</dt>
          <dd className="break-all">{pda.basket.toBase58()}</dd>
          <dt className="text-muted-foreground">Share mint</dt>
          <dd className="break-all">{pda.shareMint.toBase58()}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <a
            href={explorerTxUrl(signature, RPC_ENDPOINT)}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            View on explorer
          </a>
          <Link
            href="/portfolio"
            className="rounded-lg bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Open portfolio
          </Link>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Rankings, NAV and holdings appear once the indexer picks up the
          BasketCreated event. The basket is immutable — constituents, weights,
          fees, creator and metadata hash never change.
        </p>
      </div>
    );
  }

  const busy = phase === "simulating" || phase === "awaiting-wallet" || phase === "pending";
  const blocked = validationErrors.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Basket PDA</dt>
        <dd className="break-all font-mono tabular-nums" title={pda.basket.toBase58()}>
          {pda.basket.toBase58()}
        </dd>
        <dt className="text-muted-foreground">Share mint PDA</dt>
        <dd className="break-all font-mono tabular-nums" title={pda.shareMint.toBase58()}>
          {pda.shareMint.toBase58()}
        </dd>
        <dt className="text-muted-foreground">Vault authority</dt>
        <dd className="break-all font-mono tabular-nums" title={pda.vaultAuthority.toBase58()}>
          {pda.vaultAuthority.toBase58()}
        </dd>
        <dt className="text-muted-foreground">Nonce</dt>
        <dd className="flex items-center gap-2 font-mono tabular-nums">
          {nonce}
          <button
            type="button"
            onClick={onNonceRegenerate}
            disabled={busy}
            className="rounded-sm px-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            regenerate
          </button>
        </dd>
        <dt className="text-muted-foreground">Fees</dt>
        <dd className="font-mono tabular-nums">
          {formatBps(entryFeeBps)} / {formatBps(exitFeeBps)} / {formatBps(managementFeeBps)}{" "}
          <span className="text-muted-foreground">(entry / exit / mgmt)</span>
        </dd>
        <dt className="text-muted-foreground">Est. tx size</dt>
        <dd className={`font-mono tabular-nums ${overLimit ? "text-muted-foreground" : ""}`}>
          ~{estSize.toLocaleString()} B {overLimit ? `— exceeds the ${PACKET_LIMIT} B packet limit without lookup tables` : ""}
        </dd>
      </dl>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Metadata (hashed, not uploaded)</h3>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(metadataJson).catch(() => {})}
            className="rounded-sm px-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            copy JSON
          </button>
        </div>
        <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[11px] leading-4">
          {metadataJson}
        </pre>
        <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
          sha256 = {toHex(metadataHash)}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          IPFS/Arweave upload is out of scope for V0 — this wizard hashes the
          JSON directly with sha256 and stores the 32-byte digest on-chain. The
          metadata hash is immutable; publish the JSON yourself if you want it
          resolvable.
        </p>
      </div>

      {blocked && (
        <ErrorState
          title="Inputs invalid"
          message={validationErrors.join(" ")}
        />
      )}
      {overLimit && !blocked && (
        <p className="rounded-md border border-border/60 bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
          This basket touches {9 + constituents.length * 4} accounts, so the
          serialized transaction is ~{estSize.toLocaleString()} bytes — over the
          {` ${PACKET_LIMIT} `}byte Solana packet limit without address lookup
          tables. Simulation and sending may fail until V1 adds lookup-table
          support. Fewer constituents fit in a single transaction.
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
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-5">
          <p>
            Transaction sent — awaiting confirmation.{" "}
            <a
              href={explorerTxUrl(signature, RPC_ENDPOINT)}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {truncateAddress(signature, 12, 8)}
            </a>
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => setReviewOpen(true)}
          disabled={blocked || busy}
        >
          Review transaction
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
            if (event.target === event.currentTarget && !busy) setReviewOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deploy-review-title"
            tabIndex={-1}
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="deploy-review-title" className="text-base font-medium">
                Review create_basket
              </h2>
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                disabled={busy}
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Close review"
              >
                ✕
              </button>
            </div>

            <section className="mt-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Arguments
              </h3>
              <dl className="mt-2 grid gap-x-4 gap-y-1 font-mono text-xs tabular-nums sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">nonce (u64)</dt>
                <dd className="break-all">{nonce}</dd>
                <dt className="text-muted-foreground">constituents (Vec&lt;Pubkey&gt;)</dt>
                <dd className="break-all">
                  {constituents.map((c) => c.mint).join(", ")}
                </dd>
                <dt className="text-muted-foreground">weights_bps (Vec&lt;u16&gt;)</dt>
                <dd>{constituents.map((c) => c.weightBps).join(", ")}</dd>
                <dt className="text-muted-foreground">entry_fee_bps (u16)</dt>
                <dd>{entryFeeBps}</dd>
                <dt className="text-muted-foreground">exit_fee_bps (u16)</dt>
                <dd>{exitFeeBps}</dd>
                <dt className="text-muted-foreground">management_fee_bps (u16)</dt>
                <dd>{managementFeeBps}</dd>
                <dt className="text-muted-foreground">metadata_hash ([u8;32])</dt>
                <dd className="break-all">{toHex(metadataHash)}</dd>
                <dt className="text-muted-foreground">seed_amounts (Vec&lt;u64&gt;)</dt>
                <dd className="break-all">
                  {constituents
                    .map((c) => `${c.seedRaw.toString()} (${c.ticker})`)
                    .join(", ")}
                </dd>
              </dl>
            </section>

            <section className="mt-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Accounts ({accountList.length}) — order exactly as serialized
              </h3>
              <ol className="mt-2 flex flex-col gap-1">
                {accountList.map((entry) => (
                  <li
                    key={entry.role}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md border border-border/60 bg-background px-2 py-1.5"
                  >
                    <span className="font-mono text-xs">{entry.role}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      {entry.note && (
                        <span className="hidden text-[11px] text-muted-foreground sm:inline">
                          {entry.note}
                        </span>
                      )}
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {entry.writable ? "mut" : "ro"}
                        {entry.signer ? " +signer" : ""}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums" title={entry.pubkey}>
                        {truncateAddress(entry.pubkey, 6, 6)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="mt-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Seed balances
              </h3>
              {balancesLoading ? (
                <p className="mt-2 text-xs text-muted-foreground">Checking creator ATAs…</p>
              ) : balances === null ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Run simulation to fetch balances.
                </p>
              ) : shortfalls.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
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
                <p className="mt-2 font-mono text-xs text-foreground">
                  All creator token balances cover the seed amounts.
                </p>
              )}
            </section>

            {simulationLogs.length > 0 && (
              <section className="mt-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Last simulation log
                </h3>
                <pre className="mt-2 max-h-32 overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[11px] leading-4 text-muted-foreground">
                  {simulationLogs.slice(-8).join("\n")}
                </pre>
              </section>
            )}

            {errorMessage && phase === "simulation-failed" && (
              <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs leading-5">
                {errorMessage}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={runSimulation}
                disabled={busy}
              >
                {phase === "simulating" ? "Simulating…" : "Simulate"}
              </Button>
              <Button
                type="button"
                onClick={deploy}
                disabled={
                  busy ||
                  blocked ||
                  balances === null ||
                  shortfalls.length > 0 ||
                  phase === "simulation-failed"
                }
              >
                {phase === "awaiting-wallet"
                  ? "Approve in wallet…"
                  : phase === "pending"
                    ? "Confirming…"
                    : "Simulate, then sign & deploy"}
              </Button>
            </div>
            <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
              Simulation runs against {RPC_ENDPOINT} before your wallet is
              asked to sign. Signing is always explicit; nothing is sent
              without approval. LEGAL_REVIEW_REQUIRED — deploying makes you the
              immutable fee recipient (90% split).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
