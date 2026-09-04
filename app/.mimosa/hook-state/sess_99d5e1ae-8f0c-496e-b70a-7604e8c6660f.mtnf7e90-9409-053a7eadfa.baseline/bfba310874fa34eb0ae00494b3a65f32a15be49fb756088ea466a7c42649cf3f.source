import { MetricCardSkeleton, Skeleton, TableRowSkeleton } from "@/components/states";

/** Route-level loading for /explore — mirrors the ranking table + metric strip shape. */
export default function ExploreLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {["Loading metric", "Loading metric", "Loading metric"].map((label, i) => (
          <div key={i} className="rounded-md border border-border p-4">
            <MetricCardSkeleton label={label} />
          </div>
        ))}
      </div>
      <div className="rounded-md border border-border p-4">
        <TableRowSkeleton rows={8} columns={6} label="Loading basket rankings" />
      </div>
    </div>
  );
}
