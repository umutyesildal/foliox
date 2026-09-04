import { Skeleton } from "@/components/states";

/** Route-level loading for /stocks — mirrors the page header + token-card grid shape. */
export default function StocksLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div
        role="status"
        aria-label="Loading tokenized stocks"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} aria-hidden="true" className="rounded-lg border border-border bg-card p-5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-1.5 h-3 w-24" />
            <Skeleton className="mt-4 h-7 w-28" />
            <Skeleton className="mt-3 h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
