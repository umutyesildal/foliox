"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";

export type ClusterHealth = "idle" | "checking" | "reachable" | "unreachable";

const HEALTH_TIMEOUT_MS = 8000;

/**
 * Cheap RPC reachability check (single getEpochInfo call). Enabled while a
 * wallet is connected, it powers the "wrong network / RPC unreachable" state:
 * if the endpoint the app targets does not answer, the connected wallet is
 * almost certainly pointed at a different cluster.
 */
export function useClusterHealth(enabled: boolean): ClusterHealth {
  const { connection } = useConnection();
  const [health, setHealth] = useState<ClusterHealth>("idle");

  useEffect(() => {
    if (!enabled) {
      setHealth("idle");
      return;
    }
    let cancelled = false;
    setHealth("checking");
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        setHealth((current) => (current === "checking" ? "unreachable" : current));
      }
    }, HEALTH_TIMEOUT_MS);
    connection
      .getEpochInfo({ commitment: "processed" })
      .then(() => {
        if (cancelled) return;
        window.clearTimeout(timer);
        setHealth("reachable");
      })
      .catch(() => {
        if (cancelled) return;
        window.clearTimeout(timer);
        setHealth("unreachable");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connection, enabled]);

  return health;
}
