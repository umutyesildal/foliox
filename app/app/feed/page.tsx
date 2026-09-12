import type { Metadata } from "next";

import FeedClient from "./feed-client";

export const metadata: Metadata = {
  title: "Feed — Basalt",
  description:
    "Trades and theses from public Basalt strategy baskets — what the community is minting, redeeming and writing.",
};

export default function FeedPage() {
  return <FeedClient />;
}
