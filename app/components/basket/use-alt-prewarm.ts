"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import {
  ensureMintRedeemAlt,
  mintRedeemNeedsAlt,
  type BasketCoreKeys,
} from "@/lib/transactions";

export type AltPrewarmStatus = "idle" | "preparing" | "ready" | "failed";

export interface SetupProgress {
  step: number;
  total: number;
}

/**
 * One-time basket-account preparation ("tek transaction" feel).
 *
 * Solana lookup tables activate a slot after creation, so a FIRST trade on a
 * basket needs the table created (and extended) before the main transaction —
 * that is why the owner saw three wallet approvals. This hook starts that
 * preparation in the background the moment the buy/redeem form opens (wallet
 * connected, basket known), so by the time the user fills amounts and presses
 * Confirm the ONLY approval left is the trade itself.
 *
 * Guarantees:
 *  - The preparation is shared with the trade-time `prepare` step: `ensureAlt`
 *    returns the SAME in-flight promise instead of starting a second, racing
 *    provisioning (two concurrent provisions could derive different slots and
 *    create two tables). If the user confirms before preparation finished, the
 *    trade simply waits for it — the old trade-time behaviour becomes the
 *    fallback, never a duplicate.
 *  - The table address is cached in the lib's module-level ALT_CACHE, so the
 *    redeem page reuses the buy page's table in the same tab; only genuinely
 *    missing addresses are ever extended.
 *  - A preparation failure never blocks trading: `ensureAlt` retries once at
 *    trade time, which is exactly the pre-existing flow.
 */
export function useAltPrewarm(keys: BasketCoreKeys | null) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [status, setStatus] = useState<AltPrewarmStatus>("idle");
  const [setupProgress, setSetupProgress] = useState<SetupProgress | null>(null);
  const [awaitingWallet, setAwaitingWallet] = useState(false);

  const tableRef = useRef<PublicKey | null>(null);
  const inFlightRef = useRef<Promise<PublicKey> | null>(null);
  const startedForRef = useRef<string | null>(null);

  const needsAlt = mintRedeemNeedsAlt(keys?.constituents.length ?? 0);

  const prepare = useCallback((): Promise<PublicKey> => {
    if (tableRef.current) return Promise.resolve(tableRef.current);
    if (inFlightRef.current) return inFlightRef.current;
    if (!publicKey || !keys) {
      return Promise.reject(new Error("Connect a wallet first."));
    }
    const run = ensureMintRedeemAlt({
      connection,
      keys,
      sendTransaction,
      onAwaitingWallet: setAwaitingWallet,
      onProgress: (step, total) => setSetupProgress({ step, total }),
    })
      .then((handle) => {
        tableRef.current = handle.lookupTableAddress;
        setStatus("ready");
        return handle.lookupTableAddress;
      })
      .catch((err) => {
        inFlightRef.current = null;
        setStatus("failed");
        throw err;
      });
    inFlightRef.current = run;
    setStatus("preparing");
    return run;
  }, [connection, keys, publicKey, sendTransaction]);

  // Pre-warm: fire once per (wallet, basket) as soon as the form is live.
  useEffect(() => {
    if (!needsAlt || !publicKey || !keys) return;
    const identity = `${publicKey.toBase58()}:${keys.basket.toBase58()}`;
    if (startedForRef.current === identity) return;
    startedForRef.current = identity;
    void prepare().catch(() => {
      // Quiet by design — the trade-time prepare step surfaces failures with
      // typed copy and a Retry action. The chip flips to the fallback line.
    });
  }, [needsAlt, publicKey, keys, prepare]);

  /** Trade-time accessor: awaits the shared preparation (or retries it once). */
  const ensureAlt = useCallback((): Promise<PublicKey> => {
    if (tableRef.current) return Promise.resolve(tableRef.current);
    return prepare();
  }, [prepare]);

  return { needsAlt, status, setupProgress, awaitingWallet, ensureAlt };
}
