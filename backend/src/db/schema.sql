-- FolioX PostgreSQL schema — V0 per spec §7
-- Run: psql $DATABASE_URL -f src/db/schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE baskets (
  pubkey TEXT PRIMARY KEY,
  factory TEXT NOT NULL,
  creator TEXT NOT NULL,
  treasury TEXT NOT NULL,
  share_mint TEXT NOT NULL UNIQUE,
  nonce BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  metadata_hash TEXT NOT NULL,
  metadata_json JSONB,
  num_constituents INT NOT NULL CHECK (num_constituents BETWEEN 2 AND 20),
  constituents TEXT[] NOT NULL,
  weights_bps INT[] NOT NULL,
  entry_fee_bps INT NOT NULL,
  exit_fee_bps INT NOT NULL,
  management_fee_bps INT NOT NULL,
  last_fee_accrual_ts TIMESTAMPTZ NOT NULL,
  CHECK (array_length(constituents,1) = num_constituents),
  CHECK (array_length(weights_bps,1) = num_constituents)
);

CREATE TABLE whitelisted_mints (
  mint TEXT PRIMARY KEY,
  decimals INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Active','PausedNewMints')),
  price_source TEXT,
  multiplier NUMERIC NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vault_holdings (
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  mint TEXT REFERENCES whitelisted_mints(mint),
  raw_amount BIGINT NOT NULL,
  multiplier NUMERIC NOT NULL DEFAULT 1,
  scaled_amount NUMERIC NOT NULL,
  decimals INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (basket, mint)
);

CREATE TABLE nav_snapshots (
  id BIGSERIAL PRIMARY KEY,
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nav NUMERIC NOT NULL,
  supply BIGINT NOT NULL,
  share_price NUMERIC NOT NULL,
  price_source JSONB NOT NULL
);
CREATE INDEX ON nav_snapshots(basket, ts DESC);

CREATE TABLE supply_snapshots (
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  supply BIGINT NOT NULL,
  PRIMARY KEY (basket, ts)
);

CREATE TABLE events (
  sig TEXT PRIMARY KEY,
  slot BIGINT NOT NULL,
  basket TEXT REFERENCES baskets(pubkey),
  type TEXT NOT NULL CHECK (type IN ('BasketCreated','Minted','Redeemed','FeeAccrued')),
  data JSONB NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON events(basket, ts DESC);
CREATE INDEX ON events(type, ts DESC);

CREATE TABLE creator_stats (
  creator TEXT PRIMARY KEY,
  basket_count INT NOT NULL DEFAULT 0,
  total_aum NUMERIC NOT NULL DEFAULT 0,
  total_fees_earned NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_positions (
  user TEXT NOT NULL,
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  share_balance BIGINT NOT NULL DEFAULT 0,
  cost_basis NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user, basket)
);
CREATE INDEX ON user_positions(user);
CREATE INDEX ON user_positions(basket);

-- V0.1 minimal: provider + fiyat karşılaştırma
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('xstock','price','index'))
);
INSERT INTO providers(id,name,type) VALUES
  ('backed','Backed Finance','xstock'),
  ('jupiter','Jupiter Price v6','price'),
  ('yahoo','Yahoo Finance','price'),
  ('nasdaq','Nasdaq Benchmark','index')
ON CONFLICT DO NOTHING;

CREATE TABLE price_snapshots (
  mint TEXT NOT NULL,
  ticker TEXT NOT NULL,
  provider TEXT NOT NULL REFERENCES providers(id),
  price_usd NUMERIC NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mint, provider, ts)
);
CREATE INDEX ON price_snapshots(ticker, provider, ts DESC);
CREATE INDEX ON price_snapshots(ts DESC);

CREATE TABLE index_snapshots (
  symbol TEXT NOT NULL,
  price_usd NUMERIC NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX ON index_snapshots(symbol, ts DESC);

-- Helper: rankings are materialized in Redis via worker; this view is for debugging
CREATE OR REPLACE VIEW basket_latest_nav AS
SELECT DISTINCT ON (basket) basket, nav, supply, share_price, ts
FROM nav_snapshots ORDER BY basket, ts DESC;
