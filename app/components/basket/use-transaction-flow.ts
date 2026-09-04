"use client";

import { useCallback, useRef, useState } from "react";
import {
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
  type TransactionSignature,
} from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { describeRpcError, describeWalletError } from "@/lib/wallet";
import {
  computeBudgetInstructions,
  decodeProgramError,
  isMintPausedError,
} from "@/lib/transactions";

/**
 * Local transaction-flow state machine shared by Buy / Redeem / the accrual
 * crank: (optional lookup-table preparation) → simulate → awaiting-signature
 * (wallet open) → confirming → confirmed | failed | rejected. Simulation runs
 * BEFORE the wallet prompt so program errors (WeightMismatch, MintPaused,
 * VaultBalanceMismatch, …) surface with logs and never cost a signature.
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
  | "failed"
  | "rejected";

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
  /** Human-readable error for failed/rejected states. */
  error: string | null;
  /** Decoded basket-program error name (e.g. "MintPaused"), when applicable. */
  programErrorName: string | null;
  mintPaused: boolean;
  signature: TransactionSignature | null;
  /** Simulation logs retained on failure for the honest inline report. */
  logs: string[];
}

const INITIAL: TransactionFlowState = {
  status: "idle",
  error: null,
  programErrorName: null,
  mintPaused: false,
  signature: null,
  logs: [],
};

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
   */
  const run = useCallback(
    async (
      build: TransactionBuild,
      prepare?: () => Promise<unknown>,
    ): Promise<boolean> => {
      if (inFlight.current) return false;
      if (!publicKey) {
        setState({ ...INITIAL, status: "failed", error: "Connect a wallet first." });
        return false;
      }
      inFlight.current = true;

      // ---- 0. optional preparation (e.g. wallet-signed lookup table) ----
      if (prepare) {
        setState({ ...INITIAL, status: "preparing-alt" });
        try {
          await prepare();
        } catch (err) {
          fail({
            status: "failed",
            error:
              describeWalletError(err as { name?: string; message?: string } | null) ||
              describeRpcError(err) ||
              "Lookup-table preparation failed.",
          });
          return false;
        }
      }

      // ---- 1. build + simulate ----
      setState({ ...INITIAL, status: "simulating" });
      let legacy: Transaction | null = null;
      let prepared: PreparedTransaction | null = null;
      try {
        const built = await build();
        if (Array.isArray(built)) {
          const blockhash = await connection.getLatestBlockhash("confirmed");
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
          error: describeRpcError(err) || "Building the transaction failed.",
        });
        return false;
      }

      const simulation = legacy
        ? await connection.simulateTransaction(legacy)
        : await connection.simulateTransaction(prepared!.transaction, {
            sigVerify: false,
            replaceRecentBlockhash: true,
          });
      if (simulation.value.err) {
        const decoded = decodeProgramError(simulation.value.err);
        fail({
          status: "failed",
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
      setState((s) => ({ ...s, status: "awaiting-signature" }));
      let signature: TransactionSignature;
      try {
        signature = await sendTransaction(
          legacy ?? prepared!.transaction,
          connection,
          {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          },
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
          error: message,
          logs: [],
        });
        return false;
      }

      // ---- 3. confirm ----
      setState((s) => ({ ...s, status: "confirming", signature }));
      const blockhashCtx = legacy
        ? {
            blockhash: legacy.recentBlockhash ?? "",
            lastValidBlockHeight: legacy.lastValidBlockHeight ?? 0,
          }
        : {
            blockhash: prepared!.blockhash,
            lastValidBlockHeight: prepared!.lastValidBlockHeight,
          };
      try {
        const result = await connection.confirmTransaction(
          {
            signature,
            blockhash: blockhashCtx.blockhash,
            lastValidBlockHeight: blockhashCtx.lastValidBlockHeight,
          },
          "confirmed",
        );
        if (result.value.err) {
          const decoded = decodeProgramError(result.value.err);
          fail({
            status: "failed",
            error: decoded
              ? `${decoded.name} — ${decoded.message}`
              : "The transaction failed on-chain after signing.",
            programErrorName: decoded?.name ?? null,
            mintPaused: isMintPausedError(result.value.err),
            signature,
          });
          return false;
        }
        setState({
          ...INITIAL,
          status: "confirmed",
          signature,
        });
        inFlight.current = false;
        return true;
      } catch (err) {
        // Confirmation uncertainty is not the same as failure — surface the
        // signature either way so the user can check the explorer.
        fail({
          status: "failed",
          error:
            err instanceof Error
              ? `Confirmation could not be verified: ${describeRpcError(err)}`
              : "Confirmation could not be verified.",
          signature,
        });
        return false;
      }
    },
    [connection, publicKey, sendTransaction, fail],
  );

  return { state, run, reset, connected: Boolean(publicKey) };
}
