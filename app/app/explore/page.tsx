import type { Metadata } from "next";

import ExploreClient from "./explore-client";

export const metadata: Metadata = {
  title: "Explore baskets — FolioX",
  description:
    "Comparison-first ranking of onchain strategy baskets: AUM, share price, 24h change, holders, drift, and data freshness.",
};

export default function ExplorePage() {
  return <ExploreClient />;
}
