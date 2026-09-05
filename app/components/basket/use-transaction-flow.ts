"use client";

import { useCallback, useRef, useState } from "react";
import {
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
  type TransactionSignature,
} from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import {
  RpcRetriesExhaustedError,
  isTransientRpcError,
  withRetry,
  type RetryEvent,
} from "@/lib/rpc-retry";
import { describeRpcError, describeWalletError } from "@/lib/wallet";
import {
  computeBudgetInstructions,
  decodeProgramError,
  isMintPausedError,
} from "@/lib/transactions";

/**
 * Local transaction-flow state machine shared by Buy / Redeem / the accrual
 * crank: (optional lookup-table preparation) → simulate → awaiting-signature
 * (wallet open) → confirming → confirmed | submitted | failed | rejected.
 * Simulation runs BEFORE the wallet prompt so program errors (WeightMismatch,
 * MintPaused, VaultBalanceMismatch, …) surface with logs and never cost a
 * signature — and it runs exactly ONCE per transaction (the send uses
 * skipPreflight, so the cluster does not re-simulate an already-validated tx).
 *
 * Resilience contract (devnet 429 incident fix — every RPC call the flow makes
 * runs through lib/rpc-retry's withRetry: 6 attempts, 2s→4s→8s→16s→30s backoff):
 *   - A transient RPC failure inside preparation/build/simulate waits out the
 *     throttle and only then fails with TYPED copy + a Retry action.
 *   - A failure AFTER a wallet approval says exactly where it stopped and that
 *     funds are safe ("Lookup table created — mint step failed: …press Retry").
 *     Retry resumes from the failed step; the wallet-owned lookup table is
 *     cached at module level (survives page remounts) and re-verified on-chain,
 *     so an existing table never triggers new approvals.
 *   - A send that LANDED but whose confirmation polling kept hitting 429 is
 *     NOT an error: the flow keeps polling for ~90s and lands in the neutral
 *     "submitted" state (signature + explorer link), never "unexpected error".
 *
 * Two wire shapes:
 *  - `build` returning TransactionInstruction[] compiles a legacy Transaction;
 *    the compute-budget pair (500k CU limit + priority price) is prepended
 *    here so every legacy-path tx is budgeted.
 *  - `build` returning a PreparedTransaction (v0 message, ALT-compiled when
 *    mintRedeemNeedsAlt(n)) is simulated and sent as-is — its compute budget
 *    is already baked in by the builder.
 */

export type TransactionFlowStatus =
  | "idle"
  | "preparing-alt"
  | "simulating"
  | "awaiting-signature"
  | "confirming"
  | "confirmed"
  /** Sent and safe, but not yet visible as confirmed within the poll budget. */
  | "submitted"
  | "failed"
  | "rejected";

/** Where the flow stopped — drives the "where it stopped" failure copy. */
export type TransactionFlowStage =
  | "prepare"
  | "build"
  | "simulate"
  | "sign"
  | "confirm";

/** A v0 transaction compiled together with its blockhash context. */
export interface PreparedTransaction {
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

/** Either shape the flow can send: a legacy instruction list or a v0 tx. */
export type TransactionBuildResult = TransactionInstruction[] | PreparedTransaction;

export type TransactionBuild = () =>
  | TransactionBuildResult
  | Promise<TransactionBuildResult>;

export interface TransactionFlowState {
  status: TransactionFlowStatus;
  /** Human-readable error for failed/rejected states. Never "unexpected error". */
  error: string | null;
  /** Decoded basket-program error name (e.g. "MintPaused"), when applicable. */
  programErrorName: string | null;
  mintPaused: boolean;
  signature: TransactionSignature | null;
  /** Simulation logs retained on failure for the honest inline report. */
  logs: string[];
  /** The step the flow stopped at (failed/rejected). */
  failedStage: TransactionFlowStage | null;
  /** True when a wallet approval (ALT create/extend, earlier signature) landed before the failure. */
  approvedEarlier: boolean;
  /** False for deterministic failures (program errors) — Retry would fail identically. */
  retryable: boolean;
  /** Live progress line while the retry loop waits out a throttled RPC. */
  progress: string | null;
}

const INITIAL: TransactionFlowState = {
  status: "idle",
  error: null,
  programErrorName: null,
  mintPaused: false,
  signature: null,
  logs: [],
  failedStage: null,
  approvedEarlier: false,
  retryable: false,
  progress: null,
};

/** Confirmation poll budget for an already-submitted transaction (spec: ~90s). */
const CONFIRM_BUDGET_MS = 90_000;
/** Space between confirmation status polls. */
const CONFIRM_POLL_MS = 3_000;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useTransactionFlow() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [state, setState] = useState<TransactionFlowState>(INITIAL);
  // Guards against double-submits (modal buttons + crank) while in flight.
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    inFlight.current = false;
    setState(INITIAL);
  }, []);

  const fail = useCallback((patch: Partial<TransactionFlowState>) => {
    setState({ ...INITIAL, ...patch });
    inFlight.current = false;
  }, []);

  /**
   * Run the flow. `build` returns the instruction list (legacy wire) or a
   * PreparedTransaction (v0/ALT wire) — or throws with a client-side
   * validation message, which lands in the failed state without touching the
   * wallet. `prepare` (e.g. wallet-signed lookup-table creation) runs first
   * under the honest "preparing-alt" status.
   *
   * Idempotent-safe to re-invoke after a failure: the retry (the modal's Retry
   * button calls this again with the same build/prepare) resumes from the
   * failed step — completed preparation is cached and re-verified, not repeated.
   */
  const run = useCallback(
    async (
      build: TransactionBuild,
      prepare?: () => Promise<unknown>,
      options?: { onComplete?: () => void },
    ): Promise<boolean> => {
      if (inFlight.current) return false;
      if (!publicKey) {
        setState({ ...INITIAL, status: "failed", error: "Connect a wallet first." });
        return false;
      }
      inFlight.current = true;

      // Live progress line while the shared retry loop waits out a throttle —
      // one short sentence; the technical attempt/wait details live in the
      // browser console, not in the user's face.
      const onRetryEvent = (event: RetryEvent) => {
        void event;
        setState((s) => ({
          ...s,
          progress: "Network is busy — retrying automatically…",
        }));
      };

      /** Infrastructure failures are retryable; deterministic ones are not. */
      const retryableOf = (err: unknown): boolean =>
        err instanceof RpcRetriesExhaustedError || isTransientRpcError(err);

      /**
       * Post-approval failure copy: say exactly where it stopped and that
       * nothing was lost — the unforgivable case is a bare "unexpected error"
       * after the user already approved transactions.
       */
      const stopMessage = (stage: TransactionFlowStage, reason: string, approvedAlt: boolean): string => {
        const reasonText = reason.trim() || "the RPC call failed.";
        if (stage === "prepare") {
          return `Lookup-table preparation stopped: ${reasonText} Press Retry to continue — completed steps are kept and reused, nothing needs redoing.`;
        }
        if (approvedAlt) {
          return `Lookup table created — ${stage} step failed: ${reasonText} Your funds are safe; press Retry to continue.`;
        }
        return `${stage} step failed: ${reasonText}`;
      };

      // ---- 0. optional preparation (e.g. wallet-signed lookup table) ----
      if (prepare) {
        setState({ ...INITIAL, status: "preparing-alt" });
        try {
          await prepare();
        } catch (err) {
          const reason = describeWalletError(
            err as { name?: string; message?: string } | null,
          );
          fail({
            status: "failed",
            failedStage: "prepare",
            approvedEarlier: false,
            retryable: retryableOf(err),
            error: stopMessage("prepare", reason, false),
          });
          return false;
        }
      }

      // From here on, the user already approved lookup-table transactions —
      // every later failure must say so and offer Retry.
      const approvedAlt = Boolean(prepare);

      // ---- 1. build + simulate (exactly ONE simulation before the send) ----
      setState({ ...INITIAL, status: "simulating" });
      let legacy: Transaction | null = null;
      let prepared: PreparedTransaction | null = null;
      try {
        const built = await build();
        if (Array.isArray(built)) {
          const blockhash = await withRetry(
            () => connection.getLatestBlockhash("confirmed"),
            { label: "blockhash read", onRetry: onRetryEvent },
          );
          legacy = new Transaction({
            feePayer: publicKey,
            blockhash: blockhash.blockhash,
            lastValidBlockHeight: blockhash.lastValidBlockHeight,
          });
          legacy.add(...computeBudgetInstructions(), ...built);
        } else {
          prepared = built;
        }
      } catch (err) {
        fail({
          status: "failed",
          failedStage: "build",
          approvedEarlier: approvedAlt,
          retryable: retryableOf(err),
          error: stopMessage("build", describeRpcError(err), approvedAlt),
        });
        return false;
      }

      let simulation;
      try {
        simulation = legacy
          ? await withRetry(() => connection.simulateTransaction(legacy!), {
              label: "simulation",
              onRetry: onRetryEvent,
            })
          : await withRetry(
              () =>
                connection.simulateTransaction(prepared!.transaction, {
                  sigVerify: false,
                  replaceRecentBlockhash: true,
                }),
              { label: "simulation", onRetry: onRetryEvent },
            );
      } catch (err) {
        fail({
          status: "failed",
          failedStage: "simulate",
          approvedEarlier: approvedAlt,
          retryable: retryableOf(err),
          error: stopMessage("simulate", describeRpcError(err), approvedAlt),
        });
        return false;
      }
      if (simulation.value.err) {
        const decoded = decodeProgramError(simulation.value.err);
        fail({
          status: "failed",
          failedStage: "simulate",
          approvedEarlier: approvedAlt,
          retryable: false, // deterministic — the program rejected these inputs
          error: decoded
            ? `${decoded.name} — ${decoded.message}`
            : "The simulation failed before signing. See the logs below.",
          programErrorName: decoded?.name ?? null,
          mintPaused: isMintPausedError(simulation.value.err),
          logs: simulation.value.logs ?? [],
        });
        return false;
      }

      // ---- 2. sign via the connected wallet ----
      setState((s) => ({ ...s, status: "awaiting-signature", progress: null }));
      let signature: TransactionSignature;
      try {
        signature = await withRetry(
          () =>
            sendTransaction(legacy ?? prepared!.transaction, connection, {
              // The flow already simulated clean above — skipPreflight keeps
              // the count of simulations at ONE and removes the cluster's
              // preflight from the 429 blast radius.
              skipPreflight: true,
              preflightCommitment: "confirmed",
            }),
          { label: "wallet send", onRetry: onRetryEvent },
        );
      } catch (err) {
        const message = describeWalletError(
          err as { name?: string; message?: string } | null,
        );
        const rejected =
          message.includes("rejected") ||
          (err instanceof Error && err.name === "WalletSignTransactionError");
        fail({
          status: rejected ? "rejected" : "failed",
          failedStage: "sign",
          approvedEarlier: approvedAlt,
          retryable: rejected ? true : retryableOf(err),
          error: rejected
            ? message
            : stopMessage("sign", message, approvedAlt),
          logs: [],
        });
        return false;
      }

      // ---- 3. confirm by polling signature status (429-proof) ----
      // The send already LANDED — a rate limit here must never render as an
      // error. Poll within a ~90s budget; "confirmed" (not finalized) is the
      // success bar for the devnet UX. If the budget runs out, resolve to the
      // neutral "submitted" state: not an error, the tx usually still lands.
      setState((s) => ({ ...s, status: "confirming", progress: null, signature }));
      const deadline = Date.now() + CONFIRM_BUDGET_MS;
      let exhaustionRounds = 0;
      for (;;) {
        if (Date.now() >= deadline) break;
        let statuses;
        try {
          statuses = await withRetry(
            () =>
              connection.getSignatureStatuses([signature], {
                searchTransactionHistory: false,
              }),
            { label: "confirmation poll", deadline, onRetry: onRetryEvent },
          );
        } catch {
          // One full retry round burned inside the poll — keep the remaining
          // budget, but give up entirely after three consecutive rounds.
          exhaustionRounds += 1;
          if (exhaustionRounds >= 3 || Date.now() >= deadline) break;
          continue;
        }
        const status = statuses?.value?.[0] ?? null;
        if (status?.err) {
          const decoded = decodeProgramError(status.err);
          fail({
            status: "failed",
            failedStage: "confirm",
            approvedEarlier: approvedAlt,
            retryable: false,
            error: decoded
              ? `${decoded.name} — ${decoded.message}`
              : "The transaction failed on-chain after signing.",
            programErrorName: decoded?.name ?? null,
            mintPaused: isMintPausedError(status.err),
            signature,
          });
          return false;
        }
        if (
          status &&
          (status.confirmationStatus === "confirmed" ||
            status.confirmationStatus === "finalized")
        ) {
          setState({
            ...INITIAL,
            status: "confirmed",
            signature,
          });
          inFlight.current = false;
          // Success = refetch the page's data (Portfolio/holdings) so the new
          // balances show up without a manual refresh.
          options?.onComplete?.();
          return true;
        }
        if (Date.now() + CONFIRM_POLL_MS >= deadline) break;
        await sleepMs(CONFIRM_POLL_MS);
      }

      // Budget spent without a terminal status — submitted, NOT failed.
      setState({
        ...INITIAL,
        status: "submitted",
        signature,
      });
      inFlight.current = false;
      return false;
    },
    [connection, publicKey, sendTransaction, fail],
  );

  return { state, run, reset, connected: Boolean(publicKey) };
}
