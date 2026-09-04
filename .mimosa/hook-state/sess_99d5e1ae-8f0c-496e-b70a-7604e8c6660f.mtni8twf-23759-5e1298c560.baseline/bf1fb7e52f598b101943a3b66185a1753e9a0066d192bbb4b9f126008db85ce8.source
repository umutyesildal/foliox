import { EtfGridSkeleton } from "@/components/etfs/etf-grid";
import { Skeleton } from "@/components/states";

/** Route-level loading for /etfs — mirrors the page header + listing-card grid shape. */
export default function EtfsLoading() {
  return (
    <div aria-busy="true">
      <div className="space-y-2 pb-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <section aria-label="Loading tokenized ETF listings" className="border-t border-border py-8">
        <EtfGridSkeleton />
      </section>
    </div>
  );
}
