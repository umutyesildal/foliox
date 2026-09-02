"use client";

import { useClusterHealth } from "@/components/shell/use-cluster-health";
import { RPC_ENDPOINT, clusterFromEndpoint } from "@/lib/wallet";
import { cn } from "@/lib/utils";

/**
 * Network indicator for the header. The label is derived from the RPC endpoint
 * actually in use (localnet/devnet/testnet/mainnet-beta); the dot reflects a
 * live reachability check against that endpoint.
 */
export function NetworkIndicator({ className }: { className?: string }) {
  const cluster = clusterFromEndpoint(RPC_ENDPOINT);
  const health = useClusterHealth(true);

  const label =
    health === "unreachable" ? `${cluster} · unreachable` : cluster;
  const title = `${cluster} — ${RPC_ENDPOINT}`;

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-xs tabular-nums",
        health === "unreachable" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          health === "reachable" && "bg-primary",
          health === "unreachable" && "bg-destructive",
          (health === "checking" || health === "idle") &&
            "animate-pulse bg-muted-foreground motion-reduce:animate-none",
        )}
      />
      <span>{label}</span>
    </span>
  );
}
