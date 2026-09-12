"use client";

import { useClusterHealth } from "@/components/shell/use-cluster-health";
import { CLUSTER, RPC_ENDPOINT } from "@/lib/wallet";
import { cn } from "@/lib/utils";

/**
 * Network indicator for the header, demoted per the designer critique: a small
 * colored dot plus muted mono cluster label (no bordered chip, no red text on
 * every page). The dot carries the health signal; hover/focus reveals the RPC
 * endpoint detail via title. The label is the resolved CLUSTER
 * (NEXT_PUBLIC_CLUSTER, default devnet) — the same cluster every explorer
 * link targets.
 */
export function NetworkIndicator({ className }: { className?: string }) {
  const cluster = CLUSTER;
  const health = useClusterHealth(true);
  const title =
    health === "unreachable"
      ? `${cluster} — ${RPC_ENDPOINT} (unreachable)`
      : `${cluster} — ${RPC_ENDPOINT}`;

  return (
    <span
      title={title}
      className={cn(
        // Terminal chip: mono uppercase micro-label per the NEON FOUNDRY rule
        // (uppercase + tracked labels use mono). The dot stays the sole
        // health signal; the label itself never turns red.
        "inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          health === "reachable" && "bg-foreground/60",
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
