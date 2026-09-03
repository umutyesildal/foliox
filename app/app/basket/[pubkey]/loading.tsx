import { ChartBlockSkeleton, Skeleton, TableRowSkeleton } from "@/components/states";

/**
 * Route-level loading for /basket/[pubkey] — mirrors the detail page shape:
 * name-first header, 4-metric strip, dominant NAV chart, holdings table.
 * Child routes (buy/redeem) render their own in-page loading states.
 */
export default function BasketLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {["Share price", "AUM", "24h", "Supply"].map((label) => (
          <div key={label} className="rounded-lg border border-border bg-card p-5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <ChartBlockSkeleton label="Loading NAV history" />
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <TableRowSkeleton rows={4} columns={5} label="Loading holdings" />
      </div>
    </div>
  );
}
