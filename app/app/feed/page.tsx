import type { Metadata } from "next";

import FeedClient from "./feed-client";

export const metadata: Metadata = {
  title: "Feed — FolioX",
  description:
    "Trades and theses from public FolioX strategy baskets — what the community is minting, redeeming and writing.",
};

export default function FeedPage() {
  return <FeedClient />;
}
