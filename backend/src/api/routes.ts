/**
 * API Routes — spec §8 + V0.2 social trading layer
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
  // Social trading (V0.2) — writes are the only authed surface (ed25519 wallet
  // signature; api/auth.ts). Backend still never signs transactions.
  "POST /auth/nonce": "{wallet} => single-use nonce (5 min)",
  "POST /auth/verify": "{wallet, nonce, signature(base58 ed25519)} => bearer token (7 days)",
  "GET /users/:wallet/profile": "Social profile + follower/following/trade stats (+viewer isFollowing)",
  "PUT /me/profile": "auth: upsert handle/displayName/avatarUrl/bio/isPublic",
  "GET /users/:wallet/history": "Minted/Redeemed ledger for a wallet (basket name, shares, est. usdValue)",
  "GET /users/:wallet/equity-curve": "user_value_snapshots window (days param)",
  "GET /users/:wallet/followers|following": "Follow lists (keyset cursor)",
  "POST|DELETE /users/:wallet/follow": "auth: follow/unfollow (requires claimed target profile)",
  "GET /feed": "Unified trade + thesis feed; scope=all|following, type=all|trades|theses",
  "GET /leaderboard": "Estimated ROI ranking; window=7d|30d|all (anti-sybil eligibility)",
  "POST /posts": "auth: create thesis post {title, body, basket?}",
  "GET|DELETE /posts/:id": "Fetch full post / auth: author delete",
  "POST|DELETE /posts/:id/like": "auth: like/unlike",
  "GET|POST /posts/:id/comments": "List / auth: add comment",
} as const;
