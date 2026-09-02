"use client";

import { useClusterHealth } from "@/components/shell/use-cluster-health";
import { RPC_ENDPOINT, clusterFromEndpoint } from "@/lib/wallet";
import { cn } from "@/lib/utils";

/**
 * Network indicator for the header, demoted per the designer critique: a small
 * colored dot plus muted mono cluster label (no bordered chip, no red text on
 * every page). The dot carries the health signal; hover/focus reveals the RPC
 * endpoint detail via title.
 */
export function NetworkIndicator({ className }: { className?: string }) {
  const cluster = clusterFromEndpoint(RPC_ENDPOINT);
  const health = useClusterHealth(true);
  const title =
    health === "unreachable"
      ? `${cluster} — ${RPC_ENDPOINT} (unreachable)`
      : `${cluster} — ${RPC_ENDPOINT}`;

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          health === "reachable" && "bg-primary",
          health === "unreachable" && "bg-destructive",
          (health === "checking" || health === "idle") &&
            "animate-pulse bg-muted-foreground motion-reduce:animate-none",
        )}
      />
      <span>{cluster}</span>
      <span className="sr-only">
        {health === "unreachable" ? " (unreachable)" : ""}
      </span>
    </span>
  );
}
