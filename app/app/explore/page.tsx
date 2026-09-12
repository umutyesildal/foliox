import type { Metadata } from "next";

import ExploreClient from "./explore-client";

export const metadata: Metadata = {
  title: "Baskets — Basalt",
  description:
    "Community-made strategy baskets: who created each one, AUM, share price, holders, and performance vs the SPY benchmark.",
};

export default function BasketsPage() {
  return (
    <>
      <ExploreClient />
    </>
  );
}
