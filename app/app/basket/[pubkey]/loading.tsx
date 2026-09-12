import { ChartBlockSkeleton, Skeleton, TableRowSkeleton } from "@/components/states";

/**
 * Route-level loading for /basket/[pubkey] — mirrors the detail page shape:
 * name-first header, 4-metric strip, then hairline-divided sections (share
 * price history hero card, compact holdings table). Child routes (buy/redeem)
 * render their own in-page loading states.
 */
export default function BasketLoading() {
  return (
    <div className="space-y-8" aria-busy="true">
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
      <div className="divide-y divide-border">
        <section className="pb-10 pt-2">
          <div className="flex items-center justify-between pb-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="hairline-primary rounded-lg bg-card p-5 ring-1 ring-border">
            <ChartBlockSkeleton label="Loading share price history" />
          </div>
        </section>
        <section className="py-10">
          <div className="flex items-center justify-between pb-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <TableRowSkeleton rows={4} columns={5} label="Loading holdings" />
          </div>
        </section>
      </div>
    </div>
  );
}
