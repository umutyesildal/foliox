-- Basalt PostgreSQL schema — V0 per docs/basalt-v0-spec.md §7 (normative SQL)
--
-- IDEMPOTENT: safe to re-run on an existing database. Every statement uses
-- CREATE ... IF NOT EXISTS / CREATE OR REPLACE, so db/init.ts can apply it on
-- every boot. Apply manually with:
--     psql "$DATABASE_URL" -f src/db/schema.sql
--
-- INTEGER-SAFETY CONVENTION (AGENTS.md §2 #7 — binds every writer):
--   * Raw on-chain u64 amounts (TokenAccount.amount, share supply, event
--     gross/net/fee shares) can exceed Number.MAX_SAFE_INTEGER (2^53-1).
--     They live in BIGINT columns and MUST be bound from TypeScript as
--     decimal STRINGS (or via a BigInt-safe driver) — never as JS numbers.
--     BIGINT is i64 (ceiling 9223372036854775807): a u64 value beyond i64
--     range is REJECTED loudly by Postgres, never silently truncated. The
--     programs' amounts (token supplies, share supplies, sequential nonces)
--     stay far below that ceiling.
--   * `multiplier` and `scaled_amount` are display/NAV-only NUMERIC values
--     (scaled = raw × multiplier ÷ 10^decimals, human units). Programs use
--     raw only; the backend never feeds scaled amounts back on-chain.

BEGIN;

-- ---------------------------------------------------------------------------
-- baskets (immutable core — spec §7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS baskets (
  pubkey TEXT PRIMARY KEY,                -- basket PDA
  factory TEXT NOT NULL,                  -- FactoryConfig PDA
  creator TEXT NOT NULL,
  treasury TEXT NOT NULL,                 -- fee treasury (from FactoryConfig)
  share_mint TEXT NOT NULL UNIQUE,        -- Token-2022 share mint, 6 decimals
  nonce BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  metadata_hash TEXT NOT NULL,            -- hex of [u8;32] (IPFS content hash)
  metadata_json JSONB,                    -- off-chain name, desc, image
  num_constituents INT NOT NULL CHECK (num_constituents BETWEEN 2 AND 20),
  constituents TEXT[] NOT NULL,           -- ordered mint pubkeys
  weights_bps INT[] NOT NULL,             -- ordered, sum 10000
  entry_fee_bps INT NOT NULL,
  exit_fee_bps INT NOT NULL,
  management_fee_bps INT NOT NULL,
  last_fee_accrual_ts TIMESTAMPTZ NOT NULL,
  CHECK (array_length(constituents,1) = num_constituents),
  CHECK (array_length(weights_bps,1) = num_constituents)
);

-- ---------------------------------------------------------------------------
-- whitelist (spec §7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whitelisted_mints (
  mint TEXT PRIMARY KEY,
  decimals INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Active','PausedNewMints')),
  price_source TEXT,
  multiplier NUMERIC NOT NULL DEFAULT 1,  -- cached Scaled UI Amount multiplier
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- vault holdings snapshot per basket (updated every 30s or on event — spec §7)
-- raw_amount is u64 and MUST be bound as a string (see header convention).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_holdings (
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  mint TEXT REFERENCES whitelisted_mints(mint),
  raw_amount BIGINT NOT NULL,             -- u64 raw base units
  multiplier NUMERIC NOT NULL DEFAULT 1,  -- Token-2022 ScaledUiAmountConfig
  scaled_amount NUMERIC NOT NULL,         -- raw*multiplier/10^decimals (display)
  decimals INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (basket, mint)
);

-- ---------------------------------------------------------------------------
-- NAV snapshots (every 1 min — spec §7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nav_snapshots (
  id BIGSERIAL PRIMARY KEY,
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nav NUMERIC NOT NULL,                   -- Σ scaled*price (USD)
  supply BIGINT NOT NULL,                 -- share supply, raw u64 base units
  share_price NUMERIC NOT NULL,           -- nav / supply
  price_source JSONB NOT NULL             -- map of mint -> {price, source, asOf}
);
CREATE INDEX IF NOT EXISTS nav_snapshots_basket_ts_idx ON nav_snapshots(basket, ts DESC);

-- ---------------------------------------------------------------------------
-- share supply history (dilution tracking — spec §7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_snapshots (
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  supply BIGINT NOT NULL,                 -- raw u64 base units
  PRIMARY KEY (basket, ts)
);

-- ---------------------------------------------------------------------------
-- indexed program events (spec §7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  sig TEXT PRIMARY KEY,                   -- transaction signature
  slot BIGINT NOT NULL,
  basket TEXT REFERENCES baskets(pubkey),
  type TEXT NOT NULL CHECK (type IN ('BasketCreated','Minted','Redeemed','FeeAccrued')),
  data JSONB NOT NULL,                    -- decoded Anchor event (u64 fields as decimal strings)
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS events_basket_ts_idx ON events(basket, ts DESC);
CREATE INDEX IF NOT EXISTS events_type_ts_idx ON events(type, ts DESC);

-- ---------------------------------------------------------------------------
-- creator stats (spec §7 + AGENTS §9)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS creator_stats (
  creator TEXT PRIMARY KEY,
  basket_count INT NOT NULL DEFAULT 0,
  total_aum NUMERIC NOT NULL DEFAULT 0,
  total_fees_earned NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- user positions (spec §7; "user" is a reserved word and must stay quoted)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_positions (
  "user" TEXT NOT NULL,
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  share_balance BIGINT NOT NULL DEFAULT 0,  -- raw u64 base units
  cost_basis NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("user", basket)
);
CREATE INDEX IF NOT EXISTS user_positions_user_idx ON user_positions("user");
CREATE INDEX IF NOT EXISTS user_positions_basket_idx ON user_positions(basket);
-- cost_basis provenance: 'reference' = blended from nav_snapshots.share_price
-- by the indexer (an estimate, not a fill price). NULL = cost basis unknown.
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS cost_basis_source TEXT;

-- ---------------------------------------------------------------------------
-- position_events — idempotency ledger for user_positions writes (indexer).
-- Every Minted/Redeemed/FeeAccrued applied to balances INSERTs (sig, kind)
-- here first with ON CONFLICT DO NOTHING; a replayed signature loses the
-- race and is skipped, so re-processing can never double-count balances.
-- Keyed (sig, kind), mirroring the events table's per-signature dedupe.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS position_events (
  sig TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('Minted','Redeemed','FeeAccrued')),
  basket TEXT,                              -- informational (no FK: fee splits
                                           -- may run before baskets is indexed)
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sig, kind)
);

-- ---------------------------------------------------------------------------
-- basket_rankings — materialized view per spec §7, refreshed by the NAV
-- worker (~every 5m) with REFRESH MATERIALIZED VIEW CONCURRENTLY (the unique
-- index below makes CONCURRENTLY legal).
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS basket_rankings AS
SELECT
  b.pubkey,
  b.creator,
  b.share_mint,
  h.nav,
  h.supply,
  h.nav / NULLIF(h.supply, 0) AS share_price,
  (h.nav - first_day.nav) / NULLIF(first_day.nav, 0) AS return_30d,
  COUNT(DISTINCT e.sig) FILTER (WHERE e.type = 'Minted') AS mint_count,
  NOW() AS refreshed_at
FROM baskets b
JOIN LATERAL (
  SELECT nav, supply FROM nav_snapshots WHERE basket = b.pubkey ORDER BY ts DESC LIMIT 1
) h ON true
LEFT JOIN LATERAL (
  SELECT nav FROM nav_snapshots
  WHERE basket = b.pubkey AND ts > NOW() - '30 days'::interval
  ORDER BY ts ASC LIMIT 1
) first_day ON true
LEFT JOIN events e ON e.basket = b.pubkey
GROUP BY b.pubkey, b.creator, b.share_mint, h.nav, h.supply, first_day.nav;

CREATE UNIQUE INDEX IF NOT EXISTS basket_rankings_pubkey_idx ON basket_rankings(pubkey);
CREATE INDEX IF NOT EXISTS basket_rankings_nav_idx ON basket_rankings(nav DESC);

COMMENT ON MATERIALIZED VIEW basket_rankings IS
  'Spec §7 rankings; refresh with REFRESH MATERIALIZED VIEW CONCURRENTLY basket_rankings (NAV worker, ~5m).';

-- Debug convenience view (kept from V0.1): latest NAV row per basket.
CREATE OR REPLACE VIEW basket_latest_nav AS
SELECT DISTINCT ON (basket) basket, nav, supply, share_price, ts
FROM nav_snapshots ORDER BY basket, ts DESC;

-- ---------------------------------------------------------------------------
-- V0.1 price-comparison support (providers / price & index snapshots)
-- Kept from the existing schema, made idempotent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('xstock','price','index'))
);
INSERT INTO providers(id, name, type) VALUES
  ('backed',  'Backed Finance',     'xstock'),
  ('jupiter', 'Jupiter Price v6',   'price'),
  ('yahoo',   'Yahoo Finance',      'price'),
  ('nasdaq',  'Nasdaq Benchmark',   'index')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS price_snapshots (
  mint TEXT NOT NULL,
  ticker TEXT NOT NULL,
  provider TEXT NOT NULL REFERENCES providers(id),
  price_usd NUMERIC NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mint, provider, ts)
);
CREATE INDEX IF NOT EXISTS price_snapshots_ticker_provider_ts_idx ON price_snapshots(ticker, provider, ts DESC);
CREATE INDEX IF NOT EXISTS price_snapshots_ts_idx ON price_snapshots(ts DESC);

CREATE TABLE IF NOT EXISTS index_snapshots (
  symbol TEXT NOT NULL,
  price_usd NUMERIC NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS index_snapshots_symbol_ts_idx ON index_snapshots(symbol, ts DESC);

-- ---------------------------------------------------------------------------
-- V0.2 social trading layer — profiles, follows, thesis posts, equity curve.
-- Identity stays wallet-native: a profiles row is an OPTIONAL display layer
-- (handle/avatar/privacy) over a pubkey. Wallets without a row are treated
-- as public; is_public=false hides the wallet from the feed and leaderboard.
-- Social WRITES are the backend's only authenticated surface (ed25519 wallet
-- signature — api/auth.ts); the backend still never signs transactions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  wallet TEXT PRIMARY KEY,                -- Solana pubkey (base58)
  handle TEXT UNIQUE,                     -- 3-20 chars [a-z0-9_], null until claimed
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS follows (
  follower TEXT NOT NULL REFERENCES profiles(wallet) ON DELETE CASCADE,
  followee TEXT NOT NULL REFERENCES profiles(wallet) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower, followee),
  CHECK (follower <> followee)
);
CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows(followee);

-- Thesis posts — trade-linked reasoning (fomo-style: the "why" layer over the
-- verified on-chain "what"). kind is an allowlist so future post types are a
-- migration, not a surprise.
CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL REFERENCES profiles(wallet) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('thesis')),
  basket TEXT REFERENCES baskets(pubkey) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS posts_wallet_ts_idx ON posts(wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_ts_idx ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL REFERENCES profiles(wallet) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, wallet)
);

CREATE TABLE IF NOT EXISTS comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL REFERENCES profiles(wallet) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id, created_at);

-- Per-wallet equity curve, written by workers/userSnapshot.ts (~5m) from
-- user_positions × latest nav share_price. Feeds profile charts and the
-- windowed leaderboard. Same integer-safety rules as nav_snapshots.
CREATE TABLE IF NOT EXISTS user_value_snapshots (
  wallet TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  value_usd NUMERIC NOT NULL,
  cost_basis NUMERIC,
  PRIMARY KEY (wallet, ts)
);
CREATE INDEX IF NOT EXISTS user_value_snapshots_ts_idx ON user_value_snapshots(wallet, ts DESC);

-- Per-wallet trade history/feed lookups over the existing events ledger —
-- the indexer already attributes Minted/Redeemed to data->>'user'.
CREATE INDEX IF NOT EXISTS events_user_ts_idx ON events ((data->>'user'), ts DESC);

COMMIT;
