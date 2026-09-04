import { ChartBlockSkeleton, Skeleton } from "@/components/states";

/**
 * Route-level loading state for /market. Shape-matched to the page (title row,
 * range strip, stat chips, chart card) so loading occupies the same space as
 * the loaded content — no layout shift, no fake data.
 */
export default function MarketLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-4 w-44" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-3 w-10" />
        {["1mo", "3mo", "6mo", "1y"].map((r) => (
          <Skeleton key={r} className="h-3 w-7" />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {["QQQ", "SPY", "DIA", "^IXIC"].map((s) => (
          <Skeleton key={s} className="h-3 w-20" />
        ))}
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-4 w-64 max-w-full" />
          <ChartBlockSkeleton label="Loading market overview" />
        </div>
      </div>
    </div>
  );
}
