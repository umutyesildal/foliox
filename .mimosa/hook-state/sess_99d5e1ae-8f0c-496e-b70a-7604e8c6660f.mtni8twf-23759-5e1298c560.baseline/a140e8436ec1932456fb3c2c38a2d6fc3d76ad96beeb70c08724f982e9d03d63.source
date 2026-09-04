"use client";

import { ErrorState } from "@/components/states";

/** Route-level error boundary for /explore. */
export default function ExploreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Explore failed to render"
      message={error.message || "An unexpected error occurred while loading the basket ranking."}
      onRetry={reset}
    />
  );
}
