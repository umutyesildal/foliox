"use client";

import { useCallback, useRef, useState } from "react";
import {
  Transaction,
  type TransactionInstruction,
  type TransactionSignature,
} from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { describeRpcError, describeWalletError } from "@/lib/wallet";
import { decodeProgramError, isMintPausedError } from "@/lib/transactions";

/**
 * Local transaction-flow state machine shared by Buy / Redeem / the accrual
 * crank: simulate → awaiting-signature (wallet open) → confirming →
 * confirmed | failed | rejected. Simulation runs BEFORE the wallet prompt so
 * program errors (WeightMismatch, MintPaused, VaultBalanceMismatch, …) surface
 * with logs and never cost a signature.
 */

export type TransactionFlowStatus =
  | "idle"
  | "simulating"
  | "awaiting-signature"
  | "confirming"
  | "confirmed"
  | "failed"
  | "rejected";

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

  /**
   * Run the flow. `build` returns the instruction list (or throws with a
   * client-side validation message, which lands in the failed state without
   * touching the wallet).
   */
  const run = useCallback(
    async (build: () => TransactionInstruction[]): Promise<boolean> => {
      if (inFlight.current) return false;
      if (!publicKey) {
        setState({ ...INITIAL, status: "failed", error: "Connect a wallet first." });
        return false;
      }
      inFlight.current = true;

      // ---- 1. build + simulate ----
      setState({ ...INITIAL, status: "simulating" });
      let transaction: Transaction;
      let blockhash: { blockhash: string; lastValidBlockHeight: number };
      try {
        const instructions = build();
        blockhash = await connection.getLatestBlockhash("confirmed");
        transaction = new Transaction({
          feePayer: publicKey,
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        });
        transaction.add(...instructions);
        const simulation = await connection.simulateTransaction(transaction);
        if (simulation.value.err) {
          const decoded = decodeProgramError(simulation.value.err);
          setState({
            ...INITIAL,
            status: "failed",
            error: decoded
              ? `${decoded.name} — ${decoded.message}`
              : "The simulation failed before signing. See the logs below.",
            programErrorName: decoded?.name ?? null,
            mintPaused: isMintPausedError(simulation.value.err),
            logs: simulation.value.logs ?? [],
          });
          inFlight.current = false;
          return false;
        }
      } catch (err) {
        setState({
          ...INITIAL,
          status: "failed",
          // 429s get calm honest copy instead of the raw "Server responded
          // with 429. Retrying after 4000ms delay…" string.
          error: describeRpcError(err) || "Simulation failed.",
        });
        inFlight.current = false;
        return false;
      }

      // ---- 2. sign via the connected wallet ----
      setState((s) => ({ ...s, status: "awaiting-signature" }));
      let signature: TransactionSignature;
      try {
        signature = await sendTransaction(transaction, connection, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
      } catch (err) {
        const message = describeWalletError(
          err as { name?: string; message?: string } | null,
        );
        const rejected =
          message.includes("rejected") ||
          (err instanceof Error && err.name === "WalletSignTransactionError");
        setState({
          ...INITIAL,
          status: rejected ? "rejected" : "failed",
          error: message,
          logs: [],
        });
        inFlight.current = false;
        return false;
      }

      // ---- 3. confirm ----
      setState((s) => ({ ...s, status: "confirming", signature }));
      try {
        const result = await connection.confirmTransaction(
          {
            signature,
            blockhash: blockhash.blockhash,
            lastValidBlockHeight: blockhash.lastValidBlockHeight,
          },
          "confirmed",
        );
        if (result.value.err) {
          const decoded = decodeProgramError(result.value.err);
          setState({
            ...INITIAL,
            status: "failed",
            error: decoded
              ? `${decoded.name} — ${decoded.message}`
              : "The transaction failed on-chain after signing.",
            programErrorName: decoded?.name ?? null,
            mintPaused: isMintPausedError(result.value.err),
            signature,
          });
          inFlight.current = false;
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
        setState({
          ...INITIAL,
          status: "failed",
          error:
            err instanceof Error
              ? `Confirmation could not be verified: ${describeRpcError(err)}`
              : "Confirmation could not be verified.",
          signature,
        });
        inFlight.current = false;
        return false;
      }
    },
    [connection, publicKey, sendTransaction],
  );

  return { state, run, reset, connected: Boolean(publicKey) };
}
