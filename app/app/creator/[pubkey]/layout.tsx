import type { Metadata } from "next";

/** Route metadata — the page itself is a client component and cannot export it. */
export const metadata: Metadata = {
  title: "Creator — Basalt",
  description:
    "On-chain creator profile — deployed baskets, indexed AUM and fee totals, only when the indexer has them.",
};

export default function CreatorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
