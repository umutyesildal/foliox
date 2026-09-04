import { formatAsOf } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Data provenance marker: source + as-of timestamp, rendered muted in Geist
 * Mono (tabular). With `demo`, a visibly distinct "demo" chip is prepended so
 * fixture data can never be mistaken for live NAV (plan.md Phase 2 task 4
 * consumer — API responses carry source/as-of metadata).
 *
 * Renders nothing when `source` is empty, so pages can do
 * `{meta && <FreshnessBadge .../>}` cleanly.
 */
export function FreshnessBadge({
  source,
  asOf,
  demo = false,
  className,
}: {
  source: string;
  asOf?: string | number | Date;
  demo?: boolean;
  className?: string;
}) {
  if (!source) return null;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 overflow-hidden font-mono text-xs tabular-nums text-muted-foreground",
        className,
      )}
    >
      {demo && (
        <span
          title="Fixture data, not live"
          className="rounded-full border border-border px-1.5 py-px font-sans text-[11px] uppercase tracking-wide"
        >
          demo
        </span>
      )}
      <span className="truncate">{source}</span>
      {asOf !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">{formatAsOf(asOf)}</span>
        </>
      )}
    </span>
  );
}
