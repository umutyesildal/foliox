import type {
  BasketLeaderboardEntry,
  ThesisFeedItem,
  TradeFeedItem,
} from "@/lib/social-api";

/**
 * DEMO overlay datasets (NEXT_PUBLIC_HOME_DEMO=1) — the home live-proof band
 * AND the /feed page render these instead of fetching; clearly chipped in the
 * UI ("demo data" mono chip on both). NEVER rendered from real endpoints —
 * owner-requested demo look for the landing + social surfaces (2026-09-12).
 * If you are debugging real data, turn the flag off.
 *
 * This module is pure data (no components, no hooks). The flag read lives in
 * `lib/demo-mode.ts` (`isDemoMode()`); the home section still reads the same
 * env inline. When the flag is off these datasets are tree-shakeable dead
 * weight and every surface renders real data with its usual honest
 * empty/error states. Repo invariant preserved: flag off = real data, flag
 * on = labeled demo — nothing here ever masquerades as production data.
 *
 * Shaping rules:
 *  - Every item is structurally identical to its real endpoint type
 *    (TradeFeedItem / ThesisFeedItem / BasketLeaderboardEntry) so the same
 *    row renderers handle both modes.
 *  - `ts`/`asOf` are computed relative to module-load time so relative
 *    labels ("2m ago") read alive on every fresh page load and roll
 *    naturally as the session ages.
 *  - Avatars are deterministic https dicebear URLs seeded by handle; the
 *    avatar renderer falls back to its identicon glyph if the image fails.
 *  - Baskets carry no images on purpose — the BasketAvatar glyph IS the
 *    demo basket logo.
 *  - Thesis ids are stringified negative numbers ("-1".."-5") — synthetic,
 *    never colliding with real post ids (detailed on DEMO_THESES below).
 */

/** Minutes-ago helper — spreads the demo activity over the recent past. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** Deterministic demo avatar URL (notionists set, dark chip background). */
function demoAvatar(handle: string): string {
  return `https://api.dicebear.com/9.x/notionists/png?seed=${encodeURIComponent(handle)}&backgroundColor=1a1a1c`;
}

/**
 * Demo overlay labels real indexed devnet baskets — links land on live
 * basket pages whose metadata carries the same names
 * (scripts/social-demo-basket-metadata.mts).
 */
const REAL_BASKETS = [
  { pubkey: "CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo", name: "Foundry Tech" },
  { pubkey: "78jbGZHDiH1jSdctS9bxVkKQgNzuzt1nCX9DiimyYLir", name: "Index Plus" },
  { pubkey: "9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg", name: "Mag7 Vector" },
] as const;

// ---------------------------------------------------------------------------
// Demo baskets — the three REAL indexed devnet baskets above, cycled by the
// demo trades below.
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
 * Seeded in REAL_BASKETS order (one seed per real basket — no demo name is
 * aliased onto two baskets). Returns are believable mid/single-digit
 * percents and all holder counts are > 1000 per the demo brief.
 */
const DEMO_BASKET_SEEDS: DemoBasketSeed[] = [
  {
    basket: REAL_BASKETS[0].pubkey,
    basketName: REAL_BASKETS[0].name,
    symbol: "FTB",
    returnPct: 4.21,
    nav: "284.12",
    aum: "4820000",
    holders: 1047,
    mintCount: 8934,
    asOfMinutesAgo: 2,
  },
  {
    basket: REAL_BASKETS[1].pubkey,
    basketName: REAL_BASKETS[1].name,
    symbol: "IPB",
    returnPct: 2.87,
    nav: "118.47",
    aum: "8140000",
    holders: 2318,
    mintCount: 12450,
    asOfMinutesAgo: 3,
  },
  {
    basket: REAL_BASKETS[2].pubkey,
    basketName: REAL_BASKETS[2].name,
    symbol: "M7V",
    returnPct: 1.63,
    nav: "512.9",
    aum: "9320000",
    holders: 1208,
    mintCount: 9310,
    asOfMinutesAgo: 5,
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
 * 12 demo traders (handle + displayName vary in style), spread across the
 * three real baskets (Foundry Tech ×4, Index Plus ×5, Mag7 Vector ×3 —
 * mapped so trader handles stay coherent with the basket they trade, e.g.
 * foundryfan mints Foundry Tech). USD values are `shares × a plausible
 * $360–$590 per-share NAV` so figures cohere with the NAV column; times
 * climb from 2 to 39 minutes ago so the relative labels spread believably.
 */
const DEMO_TRADE_SEEDS: DemoTradeSeed[] = [
  { n: 1, handle: "nova_trader", displayName: "Nova", type: "Minted", shares: 12.5, usdValue: 6875, basket: REAL_BASKETS[0].pubkey, minutesAgo: 2 },
  { n: 2, handle: "elena.k", displayName: "Elena Kovacs", type: "Minted", shares: 3.2, usdValue: 1152, basket: REAL_BASKETS[1].pubkey, minutesAgo: 5 },
  { n: 3, handle: "satoshi_21", displayName: "Satoshi 21", type: "Redeemed", shares: 8, usdValue: 4240, basket: REAL_BASKETS[2].pubkey, minutesAgo: 8 },
  { n: 4, handle: "quietfounder", displayName: "Quiet Founder", type: "Minted", shares: 1.5, usdValue: 540, basket: REAL_BASKETS[1].pubkey, minutesAgo: 11 },
  { n: 5, handle: "moxie_eth", displayName: "Moxie", type: "Minted", shares: 24, usdValue: 14160, basket: REAL_BASKETS[0].pubkey, minutesAgo: 14 },
  { n: 6, handle: "foundryfan", displayName: "Foundry Fan", type: "Minted", shares: 0.5, usdValue: 180, basket: REAL_BASKETS[0].pubkey, minutesAgo: 17 },
  { n: 7, handle: "driftwood_", displayName: "Driftwood", type: "Redeemed", shares: 5.75, usdValue: 2990, basket: REAL_BASKETS[2].pubkey, minutesAgo: 21 },
  { n: 8, handle: "0xLena", displayName: "Lena", type: "Minted", shares: 9.1, usdValue: 5096, basket: REAL_BASKETS[1].pubkey, minutesAgo: 25 },
  { n: 9, handle: "candlewick", displayName: "Candlewick", type: "Minted", shares: 6.4, usdValue: 3200, basket: REAL_BASKETS[1].pubkey, minutesAgo: 28 },
  { n: 10, handle: "alpha_sam", displayName: "Alpha Sam", type: "Redeemed", shares: 2.25, usdValue: 1170, basket: REAL_BASKETS[0].pubkey, minutesAgo: 32 },
  { n: 11, handle: "mintcondition", displayName: "Mint Condition", type: "Minted", shares: 14.8, usdValue: 8140, basket: REAL_BASKETS[2].pubkey, minutesAgo: 36 },
  { n: 12, handle: "ronin.rs", displayName: "Ronin", type: "Minted", shares: 4.6, usdValue: 2530, basket: REAL_BASKETS[1].pubkey, minutesAgo: 39 },
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

// ---------------------------------------------------------------------------
// Demo theses — 5 items spread over the last ~3 hours so they interleave the
// trades above when the /feed page merges both datasets by recency.
// ---------------------------------------------------------------------------

interface DemoThesisSeed {
  /** Synthetic post number — the exported id is `-${n}`. */
  n: number;
  /** Index into DEMO_TRADES — reuses the same 12 demo traders/avatars. */
  traderIndex: number;
  basket: string;
  title: string;
  body: string;
  likeCount: number;
  commentCount: number;
  /** minutes ago — interleaves the trade window (2–39) up to ~3 hours. */
  minutesAgo: number;
}

/**
 * Genuine mini-theses about the three demo-labeled real baskets — weights
 * logic, liquidity, concentration and boring-core ballast takes — so the
 * demo feed reads like real conviction, not filler copy. Authors/likes/
 * comments follow the same believability rules as the trades.
 */
const DEMO_THESIS_SEEDS: DemoThesisSeed[] = [
  {
    n: 1,
    traderIndex: 0,
    basket: REAL_BASKETS[0].pubkey,
    title: "Why I keep adding to Foundry Tech on red days",
    body: "The NVDA-led mega-cap lineup is doing exactly what the weights promise: the leaders set the pace, the software names cushion the ride, and the rest quietly compounds. I stopped trying to time the rebalance — instead I add small on red days and let the band logic do the selling for me. Four adds in two weeks, zero manual trades since.",
    likeCount: 41,
    commentCount: 7,
    minutesAgo: 9,
  },
  {
    n: 2,
    traderIndex: 2,
    basket: REAL_BASKETS[1].pubkey,
    title: "Index Plus is the boring core my portfolio was missing",
    body: "I parked the proceeds of my 'everything bagel' alt portfolio into Index Plus and my drawdown honestly halved. It tracks the broad basket with a slight quality tilt, which is exactly what I want from a core holding I never have to think about. Not exciting — that is the point.",
    likeCount: 18,
    commentCount: 3,
    minutesAgo: 34,
  },
  {
    n: 3,
    traderIndex: 4,
    basket: REAL_BASKETS[2].pubkey,
    title: "Mag7 Vector is the liquidity play nobody talks about",
    body: "Every name in M7V is a mega-cap with deep markets, so the basket never trades like the thin long-tail stuff. Rebalances fill at benchmark, redemptions clear without slippage stories, and the NAV line is computed off prices you could actually get filled at. Boring plumbing — but it is the reason M7V is my default parking spot for new cash.",
    likeCount: 12,
    commentCount: 2,
    minutesAgo: 76,
  },
  {
    n: 4,
    traderIndex: 6,
    basket: REAL_BASKETS[2].pubkey,
    title: "On Mag7 concentration: you are already long, so be long on purpose",
    body: "Most 'diversified' portfolios are 25%+ Mag7 through index drift anyway — pretending otherwise is the real risk. Mag7 Vector at least prices the concentration honestly instead of hiding it inside a hundred mid-caps. I size it as one deliberate position, not seven accidental ones.",
    likeCount: 27,
    commentCount: 5,
    minutesAgo: 124,
  },
  {
    n: 5,
    traderIndex: 8,
    basket: REAL_BASKETS[1].pubkey,
    title: "Index Plus is my counterweight to the growth sleeves",
    body: "Between Foundry Tech and Mag7 Vector I run hot on growth, so IPB is the ballast. The wider mix drags in up-months and then quietly funds the dip-buying everywhere else. A boring core I never have to think about beats praying for a catalyst.",
    likeCount: 5,
    commentCount: 0,
    minutesAgo: 168,
  },
];

/**
 * Thesis dataset — structurally identical to ThesisFeedItem.
 *
 * `id`s are STRINGIFIED NEGATIVE NUMBERS ("-1".."-5"): synthetic ids that can
 * never collide with real post ids, so demo items can never act on (or be
 * mistaken for) a real post — anything that fetches /posts/:id with one gets
 * a 404 by design, which is why the demo thesis card renders its full body
 * inline instead of expanding. `bodyTruncated` mirrors the real feed contract
 * (the API truncates long bodies in list view): demo bodies are stored IN
 * FULL and demo rendering ignores the flag. Authors are drawn from
 * DEMO_TRADES so wallets, handles and dicebear avatars stay consistent
 * across the trades and theses surfaces.
 */
export const DEMO_THESES: ThesisFeedItem[] = DEMO_THESIS_SEEDS.map((seed) => {
  const trader = DEMO_TRADES[seed.traderIndex];
  return {
    kind: "thesis",
    id: `-${seed.n}`,
    ts: minutesAgo(seed.minutesAgo),
    wallet: trader.wallet,
    handle: trader.handle,
    displayName: trader.displayName,
    avatarUrl: trader.avatarUrl,
    basket: seed.basket,
    basketName: DEMO_BASKET_NAMES.get(seed.basket) ?? null,
    title: seed.title,
    body: seed.body,
    bodyTruncated: true,
    likeCount: seed.likeCount,
    commentCount: seed.commentCount,
  };
});
