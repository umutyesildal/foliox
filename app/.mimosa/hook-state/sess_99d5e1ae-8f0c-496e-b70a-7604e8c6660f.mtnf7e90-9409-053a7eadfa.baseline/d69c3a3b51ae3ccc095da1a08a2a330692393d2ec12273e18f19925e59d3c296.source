import { cn } from "@/lib/utils";

/**
 * Shared skeletons. Shape-matching variants so loading content occupies the
 * same space as the loaded content (no layout shift, no fake data).
 * All bars are aria-hidden; each variant exposes a role="status" wrapper with
 * a visually hidden label. Pulse animation is disabled under
 * prefers-reduced-motion.
 */
export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-sm bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Table-shaped skeleton: `rows` grid rows, first column wider (rank/name),
 * remaining columns equal (AUM/NAV/24h/holders style metrics).
 */
export function TableRowSkeleton({
  rows = 5,
  columns = 4,
  label = "Loading rows",
  className,
}: {
  rows?: number;
  columns?: number;
  label?: string;
  className?: string;
}) {
  const safeColumns = Math.max(1, columns);
  const template = `minmax(0, 2fr) repeat(${safeColumns - 1}, minmax(0, 1fr))`;
  return (
    <div role="status" aria-label={label} className={cn("flex flex-col gap-2", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: Math.max(0, rows) }, (_, row) => (
        <div
          key={row}
          aria-hidden="true"
          className="grid items-center gap-3"
          style={{ gridTemplateColumns: template }}
        >
          {Array.from({ length: safeColumns }, (_, column) => (
            <Skeleton key={column} className="h-5" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Chart-shaped skeleton: a tall plot area with a few static placeholder bars
 * (pulsing, so it reads as loading — never as data) plus an axis strip.
 */
export function ChartBlockSkeleton({
  label = "Loading chart",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} className={cn("flex flex-col gap-3", className)}>
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="flex h-64 w-full items-end gap-2 rounded-sm border border-border/40 bg-muted/40 p-4"
      >
        <Skeleton className="h-1/4 flex-1" />
        <Skeleton className="h-2/5 flex-1" />
        <Skeleton className="h-1/3 flex-1" />
        <Skeleton className="h-3/5 flex-1" />
        <Skeleton className="h-1/2 flex-1" />
        <Skeleton className="h-3/4 flex-1" />
      </div>
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

/**
 * Metric-card-shaped skeleton: label bar + value bar (drop inside an existing
 * Card; this renders the inner content only).
 */
export function MetricCardSkeleton({
  label = "Loading metric",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} className={cn("flex flex-col gap-2", className)}>
      <span className="sr-only">{label}</span>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-32" />
    </div>
  );
}
