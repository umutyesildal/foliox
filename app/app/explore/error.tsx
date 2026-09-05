"use client";

import { ErrorState } from "@/components/states";

/**
 * Route-level error boundary for /explore. The rendered copy always carries a
 * next action — the literal words "unexpected error" are never shown.
 */
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
      message={error.message || "The basket ranking could not load — press Try again."}
      onRetry={reset}
    />
  );
}
