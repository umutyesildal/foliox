import type { Metadata } from "next";
import { Suspense } from "react";

import CreateClient from "./create-client";

export const metadata: Metadata = {
  title: "Create — FolioX",
  description:
    "Six-step wizard for deploying an immutable onchain strategy basket from whitelisted xStocks.",
};

/**
 * The wizard reads `?clone=<pubkey>` via useSearchParams, which requires a
 * Suspense boundary under Next 15 static rendering — the page shell renders
 * immediately and the client wizard streams in.
 */
export default function CreatePage() {
  return (
    <Suspense fallback={<CreateSuspenseFallback />}>
      <CreateClient />
    </Suspense>
  );
}

function CreateSuspenseFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl pb-16" role="status" aria-busy="true">
      <span className="sr-only">Loading the create wizard</span>
      <div className="h-9 w-72 animate-pulse rounded-sm bg-muted" />
      <div className="mt-3 h-4 w-64 animate-pulse rounded-sm bg-muted" />
      <div className="mt-6 h-[420px] animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
}
