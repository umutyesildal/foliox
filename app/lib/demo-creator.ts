import type {
  LeaderboardEntry,
  ThesisFeedItem,
  TradeFeedItem,
} from "@/lib/social-api";
import {
  DEMO_THESES,
  DEMO_TRADERS,
  DEMO_TRADES,
  demoAvatar,
} from "@/components/home/home-demo-data";

/**
 * Demo creator profiles (NEXT_PUBLIC_HOME_DEMO=1) — the pure data layer
 * behind /creator/demo-wallet-1..7 and the /leaderboard users tab. Zero
 * network: everything derives deterministically from the static datasets in
 * components/home/home-demo-data.ts (DEMO_TRADES / DEMO_THESES /
 * DEMO_TRADERS), so the creator pages render server-safe with no fetches —
 * the same discipline as the home band, /feed and /leaderboard demo
 * overlays. Flag off = real API data, flag on = labeled demo; nothing here
 * ever masquerades as production data.
 *
 * The demo wallet universe is exactly `demo-wallet-1..7`:
 *  - The six personas in DEMO_LEADERBOARD_SEEDS own those wallets and carry
 *    the /leaderboard figures (roiPct / valueUsd / cost basis / position
 *    count / first-trade stamp) — this module is their single source;
 *    leaderboard-client.tsx imports DEMO_LEADERBOARD_USERS instead of
 *    keeping its own copy.
 *  - demo-wallet-6 (foundryfan) is deliberately NOT on the leaderboard: a
 *    brand-new account whose stats derive from its single demo trade.
 *  - The remaining home-demo trader personas broadcast under the wallet of
 *    the persona that trades their basket (see DEMO_TRADERS in
 *    home-demo-data.ts), so every wallet in the trade/thesis feed resolves
 *    to a live creator page.
 *
 * All figures are display-only demo data: positions are plain sums over the
 * wallet's demo trades (mint vs redeem is not netted), and the social graph
 * (followers/following) is hashed from the wallet's char codes.
 */

/** Weeks-ago helper — spreads first-trade stamps over 3-9 weeks back. */
function weeksAgo(weeks: number): string {
  return new Date(Date.now() - weeks * 7 * 24 * 60 * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Demo leaderboard personas — moved verbatim from leaderboard-client.tsx so
// this module is the single source for demo identities.
// ---------------------------------------------------------------------------

interface DemoLeaderboardSeed {
  /** Wallet id (demo-wallet-<n>) — the demo wallet universe is 1-7. */
  n: number;
  handle: string;
  displayName: string;
  roiPct: number;
  valueUsd: number;
  costBasisUsd: number;
  positionCount: number;
  weeksTrading: number;
}

/**
 * Demo overlay — the identities are synthetic (negative/synthetic
 * identities). Handles / displayNames are lifted from the home demo trader
 * roster (DEMO_TRADERS in home-demo-data.ts) so the same personas appear
 * across surfaces, and wallets reuse the `demo-wallet-<n>` ids the demo
 * trades use. ROI is a believable +2.4% to +21.7% spread with one negative
 * (driftwood_ stays underwater so the board still reads honestly); cost
 * basis coheres with value × ROI. demo-wallet-6 (foundryfan) is intentionally
 * absent — that brand-new account's creator page derives its stats from its
 * own demo trade instead.
 */
const DEMO_LEADERBOARD_SEEDS: DemoLeaderboardSeed[] = [
  { n: 1, handle: "nova_trader", displayName: "Nova", roiPct: 21.7, valueUsd: 126_000, costBasisUsd: 103_500, positionCount: 5, weeksTrading: 9 },
  { n: 3, handle: "satoshi_21", displayName: "Satoshi 21", roiPct: 14.2, valueUsd: 94_500, costBasisUsd: 82_800, positionCount: 4, weeksTrading: 8 },
  { n: 5, handle: "moxie_eth", displayName: "Moxie", roiPct: 9.6, valueUsd: 47_800, costBasisUsd: 43_600, positionCount: 4, weeksTrading: 7 },
  { n: 2, handle: "elena.k", displayName: "Elena Kovacs", roiPct: 6.3, valueUsd: 26_300, costBasisUsd: 24_750, positionCount: 3, weeksTrading: 5 },
  { n: 4, handle: "quietfounder", displayName: "Quiet Founder", roiPct: 2.4, valueUsd: 12_950, costBasisUsd: 12_650, positionCount: 2, weeksTrading: 4 },
  { n: 7, handle: "driftwood_", displayName: "Driftwood", roiPct: -1.8, valueUsd: 8_400, costBasisUsd: 8_550, positionCount: 3, weeksTrading: 3 },
];

/**
 * Demo users leaderboard — structurally identical to LeaderboardEntry so the
 * real Row renderer handles it unchanged. Ranked by roiPct DESC — the order
 * the real users endpoint returns. Consumed by /leaderboard (users tab) and
 * by getDemoCreator (identity + headline stats per wallet).
 */
export const DEMO_LEADERBOARD_USERS: LeaderboardEntry[] = DEMO_LEADERBOARD_SEEDS.map((seed) => ({
  wallet: `demo-wallet-${seed.n}`,
  handle: seed.handle,
  displayName: seed.displayName,
  avatarUrl: demoAvatar(seed.handle),
  roiPct: seed.roiPct,
  valueUsd: seed.valueUsd,
  costBasisUsd: seed.costBasisUsd,
  positionCount: seed.positionCount,
  firstTradeAt: weeksAgo(seed.weeksTrading),
})).sort((a, b) => (b.roiPct ?? 0) - (a.roiPct ?? 0));

// ---------------------------------------------------------------------------
// Demo creator profiles — /creator/demo-wallet-1..7 data.
// ---------------------------------------------------------------------------

/** One open position on a demo creator page (folded from demo trades). */
export interface DemoCreatorPosition {
  basket: string;
  basketName: string;
  shares: number;
  usdValue: number;
}

/** Headline stats strip on a demo creator page. */
export interface DemoCreatorStats {
  followers: number;
  following: number;
  /** Number of demo trades in the wallet's recent-activity window. */
  trades: number;
  /** Leaderboard figure for board personas; 0 for brand-new accounts. */
  roiPct: number;
  /** Leaderboard figure for board personas; folded value for new accounts. */
  valueUsd: number;
  /** Leaderboard figure for board personas; folded count for new accounts. */
  positionCount: number;
  /** Leaderboard firstTradeAt, else the wallet's earliest demo trade stamp. */
  memberSince: string;
}

/**
 * The full demo creator payload the /creator overlay renders. `trades` and
 * `theses` reuse the exact feed row types so the same renderers handle both
 * the /feed page and the creator page's activity lists.
 */
export interface DemoCreator {
  wallet: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  stats: DemoCreatorStats;
  positions: DemoCreatorPosition[];
  trades: TradeFeedItem[];
  theses: ThesisFeedItem[];
}

/** The demo wallet universe — the only wallets that resolve to a page. */
const DEMO_WALLET_PATTERN = /^demo-wallet-([1-7])$/;

/**
 * Deterministic social-graph seed from the wallet's char codes — the same
 * wallet always yields the same follower/following counts on every render.
 */
function walletHash(wallet: string): number {
  let hash = 0;
  for (let i = 0; i < wallet.length; i += 1) {
    hash = (hash * 31 + wallet.charCodeAt(i)) % 100_000;
  }
  return hash;
}

/**
 * Resolve the demo creator payload for one of the seven demo wallets
 * (`demo-wallet-1..7`); null for anything else — real wallets fall through
 * to the real creator page. Pure data: no fetches, no env reads, no time
 * beyond the dataset's own relative stamps.
 */
export function getDemoCreator(wallet: string): DemoCreator | null {
  if (!DEMO_WALLET_PATTERN.test(wallet)) return null;

  // Identity: the leaderboard persona that owns this wallet when there is
  // one, otherwise the first roster persona broadcasting on it (only
  // demo-wallet-6 / foundryfan hits the fallback).
  const boardEntry = DEMO_LEADERBOARD_USERS.find((entry) => entry.wallet === wallet);
  const identity =
    (boardEntry
      ? DEMO_TRADERS.find((trader) => trader.handle === boardEntry.handle)
      : undefined) ?? DEMO_TRADERS.find((trader) => trader.wallet === wallet);
  if (!identity) return null;

  // Feed slices — DEMO_TRADES / DEMO_THESES are newest-first, so the filters
  // keep the same order the /feed page renders.
  const trades = DEMO_TRADES.filter((trade) => trade.wallet === wallet);
  const theses = DEMO_THESES.filter((thesis) => thesis.wallet === wallet);

  // Fold the wallet's demo trades into positions by basket: plain sums of
  // shares and usd value (mint vs redeem is NOT netted — display-only demo
  // figures), largest value first.
  const byBasket = new Map<string, DemoCreatorPosition>();
  for (const trade of trades) {
    const position = byBasket.get(trade.basket) ?? {
      basket: trade.basket,
      basketName: trade.basketName ?? "",
      shares: 0,
      usdValue: 0,
    };
    position.shares += trade.shares;
    position.usdValue += trade.usdValue ?? 0;
    byBasket.set(trade.basket, position);
  }
  const positions = Array.from(byBasket.values()).sort((a, b) => b.usdValue - a.usdValue);

  // Deterministic small social graph (40-2400) from the wallet char codes.
  const hash = walletHash(wallet);
  const followers = 40 + (hash % 2361);
  const following = 40 + ((hash * 7 + 13) % 2361);

  // memberSince = the leaderboard firstTradeAt when the wallet has one, else
  // the wallet's earliest demo trade stamp (foundryfan's only trade).
  const memberSince =
    boardEntry?.firstTradeAt ??
    trades.reduce<string | null>(
      (earliest, trade) =>
        earliest === null || Date.parse(trade.ts) < Date.parse(earliest)
          ? trade.ts
          : earliest,
      null,
    ) ??
    new Date().toISOString();

  return {
    wallet,
    handle: identity.handle,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    bio: identity.bio,
    stats: {
      followers,
      following,
      trades: trades.length,
      // Leaderboard figures stay canonical for the six board personas;
      // wallets without a board row (foundryfan) derive honestly from their
      // own tiny demo history instead of borrowing someone else's numbers.
      roiPct: boardEntry?.roiPct ?? 0,
      valueUsd:
        boardEntry?.valueUsd ?? positions.reduce((sum, position) => sum + position.usdValue, 0),
      positionCount: boardEntry?.positionCount ?? positions.length,
      memberSince,
    },
    positions,
    trades,
    theses,
  };
}
