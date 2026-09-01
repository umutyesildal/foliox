#!/usr/bin/env bash
set -euo pipefail
# FolioX E2E — deterministic localnet flow (requires solana-test-validator + anchor)
# Steps match docs/foliox-v0-spec.md §10.2

echo "== FolioX E2E (V0) =="
echo "Programs:"
echo "  whitelist      bdEDPr9KGtkSABS8Sg3gWeJKyQEaTQVaBRvCu38YMNz"
echo "  basket_factory sXShikYX7G5n3S3qp78RWQBxh2YJARLvufiCoaxjAyq"
echo "  basket         37VPGtd57kXJ1HvH1xvdZr1y3s4KXj9pP2o6GdYLgbb1"
echo ""
if ! command -v solana >/dev/null 2>&1; then echo "solana not found — install via sh -c \"\$(curl -sSfL https://release.solana.com/v1.18.17/install)\""; exit 1; fi
if ! command -v anchor >/dev/null 2>&1; then echo "anchor not found — cargo install via avm"; exit 1; fi

anchor build
echo "✓ anchor build ok"
cargo test -p basket
echo "✓ Rust math tests ok"

# Optional SBF build
echo "Next: solana-test-validator --reset &"
echo "      anchor deploy --provider.cluster localnet"
echo "      node scripts/createWhitelist.ts  # mock xStocks mints"
echo "      node scripts/createBasket.ts     # 3 xStocks, 50/30/20, fees 100/50/200, seed 500/300/200, genesis 1M"
echo "      node scripts/mintAndRedeem.ts    # user2 mints 10% → redeems 50% → assert pro-rata floor"
echo "      node scripts/accrueFee.ts        # warp 30d, accrue mgmt fee, assert cap 300 bps"
echo "      curl localhost:3001/api/v1/baskets && curl localhost:3001/api/v1/health"
