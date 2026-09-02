import { ChartBlockSkeleton, MetricCardSkeleton, Skeleton, TableRowSkeleton } from "@/components/states";

/**
 * Route-level loading for /basket/[pubkey] — mirrors the detail page shape:
 * identity header, 4-metric strip, dominant NAV chart, constituents table.
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
        {["NAV", "Share price", "Supply", "AUM"].map((label) => (
          <div key={label} className="rounded-md border border-border p-4">
            <MetricCardSkeleton label={label} />
          </div>
        ))}
      </div>
      <div className="rounded-md border border-border p-4">
        <ChartBlockSkeleton label="Loading NAV history" />
      </div>
      <div className="rounded-md border border-border p-4">
        <TableRowSkeleton rows={4} columns={5} label="Loading constituents" />
      </div>
    </div>
  );
}
