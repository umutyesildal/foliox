import type { Metadata } from "next";

import LeaderboardClient from "./leaderboard-client";

export const metadata: Metadata = {
  title: "Leaderboard — FolioX",
  description:
    "Public FolioX traders ranked by estimated portfolio return over 7 days, 30 days and all time.",
};

export default function LeaderboardPage() {
  return <LeaderboardClient />;
}
