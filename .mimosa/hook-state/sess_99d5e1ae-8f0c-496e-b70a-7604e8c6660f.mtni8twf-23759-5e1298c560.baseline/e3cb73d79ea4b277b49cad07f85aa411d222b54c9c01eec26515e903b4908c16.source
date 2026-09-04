/**
 * API Routes — spec §8
 * GET /baskets, /baskets/:pubkey, /holdings, /nav/history, /quotes/zap-in|out
 */
export const routes = {
  "GET /baskets": "List baskets sorted by AUM/return, filters: creator, minAUM, search",
  "GET /baskets/:pubkey": "Detail: constituents, weights, fees, NAV, supply, drift, metadata",
  "GET /baskets/:pubkey/holdings": "raw+scaled per mint (raw, multiplier, scaled, decimals)",
  "GET /baskets/:pubkey/nav/history": "timeseries interval 1h, from/to",
  "GET /baskets/:pubkey/performance": "24h/7d/30d/inception returns from snapshots",
  "GET /creators/:creator": "Creator profile: baskets, AUM, fees earned",
  "GET /users/:user/portfolio": "Positions + scaled value per basket",
  "POST /quotes/zap-in": "{basket, amountUSDC, slippageBps} => legs via Jupiter quote+swap",
  "POST /quotes/zap-out": "{basket, shares, targetMint} => legs",
} as const;
