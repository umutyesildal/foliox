import type {
  BasketLeaderboardEntry,
  TradeFeedItem,
} from "@/lib/social-api";

/**
 * DEMO overlay for the home live-proof band (NEXT_PUBLIC_HOME_DEMO=1).
 * NEVER rendered from real endpoints — owner-requested demo look for the
 * landing surface (2026-09-12); clearly chipped in the UI. If you are
 * debugging real data, turn the flag off.
 *
 * This module is pure data (no components, no hooks). The flag read itself
 * lives in live-proof-section.tsx (`process.env.NEXT_PUBLIC_HOME_DEMO ===
 * "1"`); when the flag is off these datasets are tree-shakeable dead weight
 * and the section renders the real feed/leaderboard with its usual honest
 * empty/error states. Repo invariant preserved: flag off = real data, flag
 * on = labeled demo — nothing here ever masquerades as production data.
 *
 * Shaping rules:
 *  - Every item is structurally identical to its real endpoint type
 *    (TradeFeedItem / BasketLeaderboardEntry) so the same row renderers
 *    handle both modes.
 *  - `ts`/`asOf` are computed relative to module-load time so relative
 *    labels ("2m ago") read alive on every fresh page load and roll
 *    naturally as the session ages.
 *  - Avatars are deterministic https dicebear URLs seeded by handle; the
 *    avatar renderer falls back to its identicon glyph if the image fails.
 *  - Baskets carry no images on purpose — the BasketAvatar glyph IS the
 *    demo basket logo.
 */

/** Minutes-ago helper — spreads the demo activity over the recent past. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** Deterministic demo avatar URL (notionists set, dark chip background). */
function demoAvatar(handle: string): string {
  return `https://api.dicebear.com/9.x/notionists/png?seed=${encodeURIComponent(handle)}&backgroundColor=1a1a1c`;
}

// ---------------------------------------------------------------------------
// Demo baskets — ids demo-basket-1..5, cycled by the demo trades below.
// ---------------------------------------------------------------------------

interface DemoBasketSeed {
  basket: string;
  basketName: string;
  symbol: string;
  returnPct: number;
  nav: string;
  aum: string;
  holders: number;
  mintCount: number;
  asOfMinutesAgo: number;
}

/**
 * Seeded in basket-id order (demo-basket-1..5). Returns are believable
 * mid/single-digit percents — one basket slightly underwater so the column
 * still reads honestly (a losing basket is stated, not shouted). All holder
 * counts are > 1000 per the demo brief.
 */
const DEMO_BASKET_SEEDS: DemoBasketSeed[] = [
  {
    basket: "demo-basket-1",
    basketName: "Foundry Tech",
    symbol: "FTX",
    returnPct: 4.21,
    nav: "284.12",
    aum: "4820000",
    holders: 1047,
    mintCount: 8934,
    asOfMinutesAgo: 2,
  },
  {
    basket: "demo-basket-2",
    basketName: "Index Plus",
    symbol: "IPX",
    returnPct: 2.87,
    nav: "118.47",
    aum: "8140000",
    holders: 2318,
    mintCount: 12450,
    asOfMinutesAgo: 3,
  },
  {
    basket: "demo-basket-3",
    basketName: "Yield Haven",
    symbol: "YHX",
    returnPct: -0.94,
    nav: "24.63",
    aum: "12650000",
    holders: 3412,
    mintCount: 6720,
    asOfMinutesAgo: 4,
  },
  {
    basket: "demo-basket-4",
    basketName: "Mag7 Vector",
    symbol: "M7V",
    returnPct: 1.63,
    nav: "512.9",
    aum: "9320000",
    holders: 1208,
    mintCount: 9310,
    asOfMinutesAgo: 5,
  },
  {
    basket: "demo-basket-5",
    basketName: "Dividend Stack",
    symbol: "DVX",
    returnPct: 0.38,
    nav: "76.05",
    aum: "3480000",
    holders: 1930,
    mintCount: 5408,
    asOfMinutesAgo: 6,
  },
];

/**
 * Top-baskets dataset — same shape/order the baskets-leaderboard endpoint
 * would return: ranked by returnPct DESC. NAV/AUM are BigInt-safe display
 * strings exactly like the real payload (parsed at render time).
 */
export const DEMO_BASKETS: BasketLeaderboardEntry[] = DEMO_BASKET_SEEDS.map((seed) => ({
  basket: seed.basket,
  basketName: seed.basketName,
  symbol: seed.symbol,
  returnPct: seed.returnPct,
  nav: seed.nav,
  aum: seed.aum,
  holders: seed.holders,
  mintCount: seed.mintCount,
  asOf: minutesAgo(seed.asOfMinutesAgo),
})).sort((a, b) => b.returnPct - a.returnPct);

// ---------------------------------------------------------------------------
// Demo trades — 12 items, newest first, spread over the last ~40 minutes.
// ---------------------------------------------------------------------------

interface DemoTradeSeed {
  /** demo trader index — drives wallet/sig ids. */
  n: number;
  handle: string;
  displayName: string;
  type: TradeFeedItem["type"];
  shares: number;
  usdValue: number;
  basket: string;
  /** minutes ago — newest first (ascending). */
  minutesAgo: number;
}

/**
 * 12 demo traders (handle + displayName vary in style), cycling the five
 * demo baskets. USD values are `shares × a plausible $360–$590 per-share
 * NAV` so figures cohere with the NAV column; times climb from 2 to 39
 * minutes ago so the relative labels spread believably.
 */
const DEMO_TRADE_SEEDS: DemoTradeSeed[] = [
  { n: 1, handle: "nova_trader", displayName: "Nova", type: "Minted", shares: 12.5, usdValue: 6875, basket: "demo-basket-1", minutesAgo: 2 },
  { n: 2, handle: "elena.k", displayName: "Elena Kovacs", type: "Minted", shares: 3.2, usdValue: 1152, basket: "demo-basket-3", minutesAgo: 5 },
  { n: 3, handle: "satoshi_21", displayName: "Satoshi 21", type: "Redeemed", shares: 8, usdValue: 4240, basket: "demo-basket-4", minutesAgo: 8 },
  { n: 4, handle: "quietfounder", displayName: "Quiet Founder", type: "Minted", shares: 1.5, usdValue: 540, basket: "demo-basket-2", minutesAgo: 11 },
  { n: 5, handle: "moxie_eth", displayName: "Moxie", type: "Minted", shares: 24, usdValue: 14160, basket: "demo-basket-1", minutesAgo: 14 },
  { n: 6, handle: "foundryfan", displayName: "Foundry Fan", type: "Minted", shares: 0.5, usdValue: 180, basket: "demo-basket-5", minutesAgo: 17 },
  { n: 7, handle: "driftwood_", displayName: "Driftwood", type: "Redeemed", shares: 5.75, usdValue: 2990, basket: "demo-basket-4", minutesAgo: 21 },
  { n: 8, handle: "0xLena", displayName: "Lena", type: "Minted", shares: 9.1, usdValue: 5096, basket: "demo-basket-2", minutesAgo: 25 },
  { n: 9, handle: "candlewick", displayName: "Candlewick", type: "Minted", shares: 6.4, usdValue: 3200, basket: "demo-basket-3", minutesAgo: 28 },
  { n: 10, handle: "alpha_sam", displayName: "Alpha Sam", type: "Redeemed", shares: 2.25, usdValue: 1170, basket: "demo-basket-1", minutesAgo: 32 },
  { n: 11, handle: "mintcondition", displayName: "Mint Condition", type: "Minted", shares: 14.8, usdValue: 8140, basket: "demo-basket-5", minutesAgo: 36 },
  { n: 12, handle: "ronin.rs", displayName: "Ronin", type: "Minted", shares: 4.6, usdValue: 2530, basket: "demo-basket-2", minutesAgo: 39 },
];

const DEMO_BASKET_NAMES = new Map(
  DEMO_BASKET_SEEDS.map((seed) => [seed.basket, seed.basketName]),
);

/**
 * Latest-trades dataset — newest first (the same order /api/v1/feed
 * returns), structurally identical to TradeFeedItem. Sigs are
 * `demo-<n>`; the animated list appends a cycle counter to these at key
 * time so repeats never collide in AnimatePresence.
 */
export const DEMO_TRADES: TradeFeedItem[] = DEMO_TRADE_SEEDS.map((seed) => ({
  kind: "trade",
  sig: `demo-${seed.n}`,
  ts: minutesAgo(seed.minutesAgo),
  wallet: `demo-wallet-${seed.n}`,
  handle: seed.handle,
  displayName: seed.displayName,
  avatarUrl: demoAvatar(seed.handle),
  basket: seed.basket,
  basketName: DEMO_BASKET_NAMES.get(seed.basket) ?? null,
  type: seed.type,
  shares: seed.shares,
  usdValue: seed.usdValue,
}));
