import { Skeleton, TableRowSkeleton } from "@/components/states";

/** Route-level loading for /providers — mirrors the status card + registry table shape. */
export default function ProvidersLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <TableRowSkeleton rows={4} columns={5} label="Loading provider registry" />
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <TableRowSkeleton rows={4} columns={4} label="Loading xStock instruments" />
      </div>
    </div>
  );
}
