# AGENTS.md — FolioX Project Context for AI Agents

> **For: Opencode, Claude Code, Codex, Cursor, any LLM agent working in this repo**
> **Read this first before writing code.** This is the single source of truth for FolioX V0.
> Spec: `docs/foliox-v0-spec.md` (774 lines, 13 sections) | Prompt: `foliox_build_prompt.md`
> Brand: **Monochrome + Roman identity layer** (owner decisions 2026-09-02/03: classic shadcn dark/light chrome, ethereal chart data palette, Cinzel display font, laurel monogram logo, Roman numerals, --imperial purple / --pompeian red accents used sparingly; on the `roman-empire` branch — merge pending owner review). Telemetry off. Legal-review chips removed from UI (backlog).
> Status: **V0 implementation complete — protocol (real Token-2022 CPI, localnet E2E 8/8 PASS), backend (real indexer/NAV/API, 392 TS tests), frontend (new IA + two owner feedback rounds + Roman theme, browser-verified). DEVNET PAUSED ON FAUCET FUNDING** (all airdrop routes exhausted incl. browser + raw API + GitHub OAuth attempt; owner to fund `y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE` ~12 devnet SOL — staged rerun in plan.md §8b).

---

## 1. What FolioX Is (and Is Not)

**FolioX** is a Solana-first dApp for **tokenized strategy baskets** backed by **xStocks** (Backed Finance Token-2022 mints).  
A creator picks 2–20 xStocks, sets fixed weights (sum 10,000 bps), sets capped fees, seeds the basket atomically, and deploys an immutable vault. The vault holds the real xStocks on-chain and mints a **basket share token** (Token-2022, 6 decimals, 1M genesis). Investors buy with in-kind xStocks or zap USDC via Jupiter, hold one token, redeem **pro-rata oracle-free**.

*Thesis:* “Create an index. Own your thesis.” — “Onchain strategy baskets powered by xStocks.” — “One token for any tokenized equity thesis.”

**NEVER call it:** `registered ETF`, `fund`, `guaranteed return`, `safe investment`, `financial advice`, `we manage your money`. Use only: `strategy basket`, `index basket`, `onchain equity basket`, `xStocks-backed strategy token`. (`LEGAL_REVIEW_REQUIRED` everywhere — see §12).

Reference model: BasketFactory deploys basket vaults → vault holds whitelisted underlying → mints one share token → buy mints shares → redeem burns shares + returns proportional underlying → zap router is periphery → fees split creator/treasury → indexer computes NAV/rankings.

---

## 2. Non-Negotiable V0 Constraints (Do Not Violate)

1. Baskets immutable after deploy: constituents, weights, fee schedule, creator, metadata hash never change (no update ix exists).
2. No leverage, lending, derivatives, rebasing, active rebalancing, or pooled off-chain custody.
3. Every share = pro-rata ownership of real xStocks in vault.
4. `redeem_in_kind` is permissionless, oracle-free, never pausable (whitelist pause blocks mint only).
5. Backend/indexer never custodies, never holds keys able to move assets.
6. All xStocks accounting is Token-2022 **Scaled UI Amount** aware.
7. Tx uses **raw** amounts; display/NAV uses `scaled = raw × multiplier`.
8. Jupiter zap is periphery only; core must support in-kind mint/redeem.
9. Legal/risk copy placeholders required everywhere (`LEGAL_REVIEW_REQUIRED`).

If you are tempted to add `admin_withdraw`, `pause_redeem`, `oracle check`, or `off-chain custody` — **STOP**. See security checklist §11.

---

## 3. Stack

| Layer | Tech | Notes |
|-------|------|-------|
| **Solana programs** | Anchor 0.30.1, `anchor-spl` 0.30.1, `spl-token-2022` 3.0.5 | 3 programs: `whitelist`, `basket_factory`, `basket` (optional `zap_router` V0 = client sequential) |
| **Backend** | Node 20, TypeScript 5.4, PostgreSQL 15, Redis, BullMQ, `pg`, `ioredis`, `@solana/web3.js` 1.98 | Indexer is convenience only |
| **Frontend** | Next.js 15, React 19, Tailwind 3.4, `shadcn/ui` + **bklit UI** (`@bklit` registry, `area-chart`, `line-chart`, `bar-chart`, `candlestick-chart`, `grid`, `chart-tooltip`, `legend`; Brush = documented local adapter pending official distribution — see `docs/bklit-registry-findings-2026-09-01.md`), `@solana/wallet-adapter`, `@solana/spl-token` | App Router, 9 pages, 6-step wizard — **Hep bklit kullanılacak** (https://bklit.com/docs/installation) — Grafik polish: Area normalize + Candlestick OHLC + Volume Bar + Brush zoom |
| **Tokens** | SPL Token-2022 | Raw for transfers, scaled for display |
| **Oracles/prices** | Jupiter Price API v6 (NAV only) | Never gates redeem |
| **Zap** | Jupiter Swap API (quote → swap) | Sequential swaps + `mint_in_kind` in V0 |
| **Tests** | Rust `cargo test` 178 tests, TS `vitest` 373 backend tests (+1 root legacy) | Total 552 tests passing |

**Program IDs (localnet/devnet):**

```toml
# Anchor.toml:5
whitelist      = "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS" # programs/whitelist/src/lib.rs:3
basket_factory = "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF" # programs/basket_factory/src/lib.rs:6
basket         = "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k" # programs/basket/src/lib.rs:4
```

**Toolchain (verified):** `rustc 1.98`, `cargo 1.98`, `solana-cli 1.18.17`, `anchor-cli 0.30.1` via `avm 1.1.2` (`~/.cargo/bin`, `~/.avm/bin`, `~/.local/share/solana`). `anchor build` SBF currently blocked by `edition2024` crates on `rustc 1.75` platform-tools — `cargo check`/`cargo test` is authoritative (`scripts/e2e.sh:12` documents). Set `overflow-checks = true` in `Cargo.toml:9`.

---

## 4. Repository Structure

```
.
├── Anchor.toml                 # programs + cluster + wallet
├── Cargo.toml                  # workspace (3 programs) + overflow-checks
├── Cargo.lock
├── docs/
│   ├── foliox-v0-spec.md       # 774L implementation-ready spec (§1-13)
│   └── AGENT_CONTEXT.md        # (this file's companion) — same context expanded
├── foliox_build_prompt.md      # original prompt (thesis + constraints)
├── AGENTS.md                   # this file — agent entrypoint
├── CONTEXT.md                  # symlink/copy of this for other agents
├── programs/
│   ├── whitelist/src/lib.rs    # init_config, add_mint, pause/unpause, transfer_authority (13 tests)
│   ├── basket_factory/src/lib.rs # init_factory, create_basket (17 tests, validates 2-20, sum 10k, caps, atomic seed, genesis 1M)
│   └── basket/src/lib.rs       # math::{gross_shares, entry_fee, exit_fee, management_fee, split_fee, redeem_amounts}, mint_in_kind, redeem_in_kind, accrue_management_fee (84 tests)
├── backend/
│   ├── src/db/schema.sql       # 8 tables + indexes + view (baskets, whitelisted_mints, vault_holdings, nav_snapshots, events, creator_stats, user_positions)
│   ├── src/indexer/listener.ts # Event listener (poll getSignaturesForAddress, decode Program data:, write events)
│   ├── src/indexer/holdingsSync.ts # raw + multiplier → scaled
│   ├── src/workers/navEngine.ts # computeNav = Σ(scaled*price), sharePrice, drift
│   ├── src/workers/feeMath.ts  # entryFee, exitFee, managementFee, splitFee + constants BPS_DENOM, SECONDS_PER_YEAR
│   ├── src/workers/priceFetch.ts # fetchPrices (Jupiter Price v6) + mockPrices
│   ├── src/api/server.ts       # GET /baskets, /baskets/:pubkey, POST /quotes/zap-in|out, GET /health
│   ├── src/index.ts            # entrypoint :3001
│   ├── tests/foliox.test.ts    # 34 tests
│   ├── tests/super.integration.test.ts # 22 tests (security invariants)
│   ├── tests/mega.test.ts      # 230 tests (50 entry/exit/mgmt, 20 split, 20 NAV/drift, 30 redeem)
│   ├── tsconfig.json
│   └── package.json
├── app/
│   ├── app/layout.tsx          # header + wallet + footer (not investment advice)
│   ├── app/page.tsx            # landing: hero + CTA
│   ├── app/explore/page.tsx    # rankings via /api/v1/baskets
│   ├── app/basket/[pubkey]/page.tsx        # detail: NAV, sharePrice, drift, fees, holders
│   ├── app/basket/[pubkey]/buy/page.tsx    # zap vs in-kind tabs
│   ├── app/basket/[pubkey]/redeem/page.tsx # burn input, pro-rata preview
│   ├── app/create/page.tsx     # 6-step wizard (select → weights → fees → seed → legal → deploy)
│   ├── app/portfolio/page.tsx  # wallet positions
│   ├── app/legal/page.tsx      # disclosures LEGAL_REVIEW_REQUIRED
│   ├── components/BasketCard.tsx
│   ├── lib/solana.ts           # PROGRAMS, scaledAmount(raw,mult,decimals)
│   ├── tailwind.config.js
│   └── package.json
├── tests/
│   └── foliox_math.test.ts     # 1 legacy test (mirrors backend)
├── scripts/
│   └── e2e.sh                  # deterministic localnet flow (validator → whitelist → basket → mint/redeem → fee crank → curl health)
├── README.md
└── .gitignore
```

**Key files with line numbers:**

* `programs/basket/src/lib.rs:12` `math::gross_shares` — `g = D*S/V`, min across constituents, 1% tolerance, floor
* `programs/basket/src/lib.rs:38` `entry_fee`, `management_fee` — `fee = supply*bps*elapsed/(10000*31536000)`
* `programs/basket_factory/src/lib.rs:33` `create_basket` — 8 validations (len, duplicate, sum 10k, whitelist, caps, metadata_hash, seed>0, atomic transfer)
* `programs/whitelist/src/lib.rs:21` `add_mint` — decimals ≤12, price_source ≤64, status Active
* `backend/src/workers/navEngine.ts:7` `computeNav`, `backend/src/workers/feeMath.ts:4` `entryFee` etc.
* `backend/src/db/schema.sql:1` full Postgres schema

---

## 5. Solana Account Model (PDA Seeds)

| Account | Seeds | Authority | Size |
|---------|-------|-----------|------|
| `WhitelistConfig` | `b"config"` | whitelist program | 32+33+4+1 +8 disc |
| `WhitelistedMint` | `b"mint", mintPubkey` | whitelist | 32+1+8+1+68+1 +8 |
| `FactoryConfig` | `b"factory"` | basket_factory | 32+32+2+2+2+2+8+1 +8 |
| `Basket` | `b"basket", factory.key(), creator.key(), nonce.to_le_bytes()` | basket program PDA `b"basket", basket.key()` | ~820 +8 (20×Pubkey + 20×u16 + fees) |
| `BasketShareMint` | `b"share_mint", basket.key()` | PDA `b"basket", basket.key()` | Token-2022 mint, decimals 6 |
| `VaultATA` per constituent | ATA `basket_pda, mint` | basket PDA | Token-2022 account |

Basket immutable — no update ix. `FactoryConfig.creator_fee_split_bps = 9000` default (90% creator, 10% treasury) + caps `entry 300, exit 100, mgmt 300`.

Events: `BasketCreated {basket, creator, num_constituents, share_mint, ts}`, `Minted {gross, net, entry_fee}`, `Redeemed {shares_burned, exit_fee}`, `FeeAccrued {shares_minted, elapsed_sec}` (`programs/basket/src/lib.rs:222`).

---

## 6. Instructions (Args & Validations)

**Whitelist (`whitelist::`):**

* `init_config` — sets `authority = signer`
* `add_mint(decimals:u8, price_source:String)` — len≤64, decimals≤12, `config.authority == signer`, init `WhitelistedMint` PDA
* `pause_mint` / `unpause_mint` — toggles `Active ↔ PausedNewMints`, only `Active` allows `create_basket`/`mint_in_kind`
* `transfer_authority(new:Pubkey)` + `claim_authority` — 2-step

**Basket Factory (`basket_factory::`):**

* `init_factory(treasury:Pubkey, creator_split:u16)` — split ≤10000
* `create_basket(nonce:u64, constituents:Vec<Pubkey>, weights:Vec<u16>, entry:u16, exit:u16, mgmt:u16, metadata_hash:[u8;32], seed_amounts:Vec<u64>)` — validates 2-20, no dup, sum 10000, fee caps, `seed>0`, atomic `transfer_checked` creator→vault, mints genesis `GENESIS_SHARES = 1_000_000` (`programs/basket/src/lib.rs:9`), emits `BasketCreated`, increments `factory.basket_count`. Remaining accounts are whitelisted mints for verification (V0 stub trusts caller).

**Basket (`basket::`):**

* `mint_in_kind(amounts:Vec<u64>, vault_balances:Vec<u64>)` — len == `num_constituents`, `amount>0`, `accrue_internal` first, `gross = min(D*S/V)` with 1% tolerance else `WeightMismatch`, `entry_fee = gross*bps/10000`, `net = gross-fee`, `split_fee(fee,9000)`, emit `Minted`. **Client contract (implemented):** remaining_accounts = `[mint_i, user_ata_i, vault_ata_i]` triplets (3n) FOLLOWED BY n `WhitelistedMint` PDAs (total 4n); each PDA must be whitelist-program-owned with `status==Active` else `MintPaused` (fail-closed) — mirrored in `app/lib/transactions.ts`
* `redeem_in_kind(shares:u64, vault_balances:Vec<u64>)` — `shares>0`, `shares ≤ user_share_ata.amount`, `total_supply>0`, `accrue_internal`, `exit_fee = shares*bps/10000`, `burn = shares-fee`, `amount_out = V*burn/S` floor per constituent, emit `Redeemed`. **Never checks whitelist/oracle/pauser** — remaining_accounts = 3n triplets ONLY, structurally tested (`RedeemInKind` gate-free assertion).
* `accrue_management_fee()` — `elapsed = now - last_accrual`, `fee = supply*bps*elapsed/(10000*31536000)`, `split_fee`, emit `FeeAccrued`, update `last_fee_accrual_ts` (`programs/basket/src/lib.rs:131`). Permissionless.

---

## 7. Token-2022 / Scaled UI Amount

* xStocks are Token-2022 with `ScaledUiAmountConfig` extension (multiplier, e.g., `1_000_000` for 1.0 with 6 decimals). `raw` stored in `TokenAccount.amount`, used for `transfer_checked(raw, decimals)` — **programs use raw only** (`// RAW ONLY` comment on all transfers).
* `scaled = raw * multiplier / 10**decimals` for display/NAV. Indexer `holdingsSync.ts:14` reads mint via `getAccountInfo` + `unpackMint` + `getScaledUiAmountConfig`, fallback `1.0`. Frontend `lib/solana.ts:7` `scaledAmount(raw,mult,dec)`.
* Tests: mock mints `multiplier 1_000_000 → 2_000_000` (2× split), assert raw unchanged, scaled doubles, redeem still raw-pro-rata (`basket/src/lib.rs:302` `test_scaled_multiplier_invariance`, `backend/tests/foliox.test.ts:35`).

---

## 8. Math & Fees (with numbers)

**Invariant:** `share_i owns V_j * (shares_i / total_supply)` raw pro-rata per constituent.

**Mint:**

1. Accrue mgmt fee → `S`
2. If `S==0` genesis `gross = 1_000_000` (prevents inflation attack — attacker cannot set share price via dust seed; factory requires `seed>0` and weight validation `programs/basket_factory/src/lib.rs:62` + spec §11 P1)
3. `gross_j = D_j * S / V_j`, `gross = min(gross_j)`, revert if `max-min > 1%*min`
4. `entry_fee = gross*entry_bps/10000`, `net = gross-fee`

Example: `S=10_000_000`, `V=[500M,300M,200M]`, `D=[50M,30M,20M]` (50/30/20) → `gross=[1M,1M,1M] → 1M`, `entry 100bps → fee 10k, net 990k` (`docs/foliox-v0-spec.md:349`).

Off-weight `D=[60M,30M,10M]` → `gross=[1.2M,1M,0.5M]`, `max-min 700k > 1%*500k` → `WeightMismatch`.

**Redeem:** `exit_fee = B*bps/10000`, `burn = B-fee`, `out_j = V_j * burn / S_before` floor, burn `burn` shares, transfer `fee` shares to creator/treasury `split_fee(fee,9000)`.

Example: `S=10M`, `V_TSLA=550M`, `B=1M`, `exit 50bps → fee 5k, burn 995k, out=550M*995k/10M=54_725_000` (`docs/foliox-v0-spec.md:370`).

**Mgmt streaming:** `fee = supply * bps * elapsed / (10000*31536000)` (`backend/src/workers/feeMath.ts:10` + `basket/src/lib.rs:46`). Example `supply 10M, 200bps, 30d → 16,438` (`docs/foliox-v0-spec.md:405`). Split `creator = fee*9000/10000, treasury = fee-creator` remainder to treasury.

---

## 9. Backend Data Model & API

**Postgres** `backend/src/db/schema.sql:1`:

* `baskets(pubkey PK, factory, creator, treasury, share_mint UNIQUE, nonce, created_at, metadata_hash, metadata_json, num_constituents 2-20, constituents TEXT[], weights_bps INT[] sum 10k, entry/exit/mgmt bps, last_fee_accrual_ts)`
* `whitelisted_mints(mint PK, decimals, status Active/PausedNewMints, price_source, multiplier DEFAULT 1, updated_at)`
* `vault_holdings(basket, mint PK, raw_amount BIGINT, multiplier, scaled_amount, decimals, updated_at)` — updated every 30s or on event
* `nav_snapshots(id BIGSERIAL, basket, ts, nav, supply, share_price, price_source JSONB)` index `(basket,ts DESC)` — every 1m
* `events(sig PK, slot, basket, type BasketCreated|Minted|Redeemed|FeeAccrued, data JSONB, ts)` index `(basket,ts)`
* `creator_stats(creator PK, basket_count, total_aum, total_fees_earned)` + `user_positions(user,basket PK, share_balance, cost_basis)`
* View `basket_latest_nav` + Redis `nav:{basket}`, `quote:zap-in:{basket}:{amount}`, `rankings`; BullMQ queues `holdings_sync 30s`, `nav_snapshot 60s`, `price_fetch 30s`, `fee_accrue_crank 1h`

**API** `backend/src/api/server.ts:1` base `/api/v1`:

| Method | Path | Source |
|--------|------|--------|
| GET | `/baskets?sort=AUM\|return_24h\|holders&creator&minAUM&search` | `basket_rankings` view |
| GET | `/baskets/:pubkey` | `baskets` + latest `nav_snapshots` + `vault_holdings` |
| GET | `/baskets/:pubkey/holdings` | `vault_holdings` raw/scaled |
| GET | `/baskets/:pubkey/nav/history?interval&from&to` | `nav_snapshots` |
| GET | `/baskets/:pubkey/performance` | 24h/7d/30d/inception from snapshots |
| GET | `/creators/:pubkey` | `creator_stats` |
| GET | `/users/:pubkey/portfolio` | `user_positions` + nav |
| GET | `/whitelist` | `whitelisted_mints` |
| POST | `/quotes/zap-in {basket, amountUSDC, slippageBps}` | Jupiter `quote` + `swap` → legs, `warning: sequential` |
| POST | `/quotes/zap-out` | symmetric |
| GET | `/health` | `{"ok":true,"version":"0.1.0"}` |

Backend never signs — if indexer dies, `redeem_in_kind` still works via RPC direct.

---

## 10. Frontend Page Map (Next.js App Router — new IA, owner-approved 2026-09-03)

> **UI decisions (owner, 2026-09-02/03):** monochrome UI chrome (classic shadcn dark/light; primary = white/near-black) + **ethereal chart data palette** (`--chart-1..5` sage/rose/blue/sand/lavender; benchmark gray dashed; red reserved for errors). NO site footer. NO LEGAL_REVIEW_REQUIRED chips in the UI (review backlog; the wizard's legal-checkbox step + `/legal` page remain functional). Baskets are NEVER called "ETFs" in UI copy (hard legal ban) — the generic category explanation lives on Home. Charts = verified-official Bklit consumer props (see `docs/bklit-registry-findings-2026-09-01.md`; Brush = documented local adapter). Candlestick/volume/brush UI REMOVED from the stock page at owner request — stock page = one clean fitY-domain AreaChart with text range buttons.

```
app/
  layout.tsx              # flex min-h-screen shell, WalletProvider, header (Stocks · ETFs · Baskets + Create/Portfolio), network chip, wallet button — NO footer
  page.tsx                # Home: shadcn hero → framed product visual (/brand/market-hero.png, swappable) → Traditional-vs-Tokenized interactive → 01/02/03 gateway rows
  stocks/page.tsx         # provider-grouped tokenized-stock grid (live price, 24h, sparkline, provider filter) → /stock/[ticker]
  etfs/page.tsx           # pure tokenized-ETF listing grid (sort, clickable cards); education comparison lives on Home
  explore/page.tsx        # "Baskets" flagship: grid-only cards — name-first (metadata_json), composition + price + 24h + vs-SPY; whole card links to /basket/[pubkey]; search + sort; honest NOT INDEXED state
  basket/[pubkey]/page.tsx  # detail (honest NOT INDEXED until indexed); buy/page.tsx (In-Kind exact-validation + Zap provenance tabs); redeem/page.tsx (pro-rata floor preview, oracle-free)
  create/page.tsx         # 6-step wizard: wallet gate banner top + Next disabled until connected; native slim RangeField sliders; weights editable freely but Next/deploy requires exactly 10k (+ Normalize button); fees = 3 slim rows + worked example; seed step in whole-token language with live estimated value; legal-checkbox step functional
  portfolio/page.tsx      # wallet-gated positions (indexer-fed)
  creator/[pubkey]/page.tsx # "Creator <truncated>" header, indexer-fed stats or honest empty
  legal/page.tsx          # disclosure document (linked from wizard checkboxes)
  stock/[ticker]/page.tsx # stat cards (price / copy-icon mint / token-vs-equity) + ONE clean fitY-domain 3-series AreaChart + text range buttons
  market/page.tsx         # normalized 4-index chart (unlinked from nav; benchmark source for Baskets vs-SPY)
  providers/page.tsx      # source registry + backend status strip (unlinked from nav)
components/stocks/*        # stocks grid + ChangeValue helper (shared 24h coloring via chart tokens)
components/etfs/*          # etf-grid (clickable cards), traditional-vs-tokenized (interactive, rendered on Home)
components/create/*        # wizard components incl. wallet-gate banner + RangeField (slim native slider)
components/charts/*        # verified-official Bklit sources; chart-brush.tsx = documented local adapter (used by Market)
components/ui/*            # card (canonical p-5 padding system), button, slider, copy-button…
lib/solana.ts              # PROGRAMS (on-curve IDs), scaledAmount
lib/transactions.ts + lib/create-basket.ts  # client Anchor builders (4n mint contract; mirrors program source)
```

Wizard gates: wallet connected (Next disabled otherwise), `2≤len≤20` Active mints, weights editable freely while adjusting but Next/deploy requires `sum==10000` exactly (Normalize button provided), fee caps `300/100/300`, legal checkboxes → `Deploy` calls `basket_factory.create_basket` (review modal lists every account + arg).

---

## 11. Security Checklist (Must Pass Before Mainnet)

* **P0:** signer on `creator`/`user`/`authority`; owner checks `Token2022` for vault/mint; no `admin_withdraw` (grep `transfer` only in mint/redeem); redeem not pausable (no whitelist/oracle/backend check); oracle-free redeem (`programs/basket/src/lib.rs:103` has no oracle account)
* **P1:** pro-rata `V*burn/S` floor; genesis `1M` fixed vs inflation attack (factory `seed>0` + weight check); rounding dust favors remaining holders; `transfer_checked` with `decimals` from whitelist; `// RAW ONLY`; ATA substitution `owner==user` + `mint==expected` + `getAssociatedTokenAddress`; PDA seeds `#[account(seeds=[...],bump)]`; fee `≤ cap` + `treasury+creator == fee`
* **P2:** zap slippage sequential not atomic (`docs/foliox-v0-spec.md:295`); CPI only to Token2022/System/ATA; seed atomic same tx as `create_basket` (no init→seed two-step)
* Run `cargo audit`, `npm audit`, `cso` skill, `review-and-iterate` skill before `deploy-to-mainnet`.

---

## 12. Legal / Product-Risk Checklist (`LEGAL_REVIEW_REQUIRED` — not legal advice)

| Area | V0 | Risk |
|------|----|------|
| Language | `strategy basket` family only, never ETF/fund/guaranteed | securities |
| Not advice | footer + wizard step 5 + `brand.md` | creator not adviser |
| Jurisdiction | frontend geo-block + disclaimer, no on-chain gate (can't gate redeem) | US etc. |
| xStocks instrument | detail + redeem explainer: Backed structured instrument, not direct equity | issuer disclosure |
| Creator liability | profile disclaimer + fees disclosed pre-mint, 90/10 split is compensation | |
| Fees disclosure | wizard preview net shares, detail fee schedule, portfolio cost basis | consumer |
| Custody | docs “self-custodial, permissionless redeem”, indexer never custodies | TVL |
| Risk copy | portfolio/redeem modal: depeg, contract risk, multiplier, slippage 1-3%, drift | drift bar |
| Metadata immutable | `metadata_hash` immutable thesis, reduces rug via weight change | |
| No yield promises | historical NAV only, not projected APY | marketing |
| Upgrade authority | upgradable multisig + disclose timelock V1 | |

Placeholder copy must be replaced by counsel before mainnet.

---

## 13. Testing — Super Many (552 tests, All Passing)

**Rust `cargo test` 178 tests** (`cargo test -p basket` 119 + `basket_factory` 38 + `whitelist` 21):

* Gross: perfect/min, 20 constituents, tolerance 1% pass/fail `t5`/`t6`, zero supply/vault/deposit/len, dust ZeroShares `t7`, large u64 no overflow `t27`, single constituent `t5-single`
* Fees: entry 0/100/300, exit 0/100, split 90/10 dust `split_fee(1,9000)=(0,1)` `t15`, never exceeds gross `t19`, mgmt zero elapsed/supply/bps `t12`, yearly cap 300k `t12`, hourly vs yearly + compounding `t39`, 50 random fuzz `MEGA`
* Redeem: floor 54.725M `t40`, full/half, dust 0, never exceeds vault `t26`, multi-vault 50/30/20, rounding never over-withdraws `t32`, pro-rata max `t22`, consistency after ops `t40`
* Invariants: multiplier 0.5–10× invariance `t31`, deposits→full redeem `t23`, genesis 1M `t36`, token decimal mismatch 6 vs 9 `t10`, reentry no CPI `t32`

**TS `vitest run` 373 backend tests**:

* `backend/tests/foliox.test.ts:1` 34 tests (fee 30d 16438, NAV 191k, drift 1000/-1000, weight mismatch, holdings scaled)
* `super.integration.test.ts:1` 22 tests (P0/P1/P2 security invariants, factory 2-20/duplicate/metadata, holdings/NAV 20 constituents, 200 random mint/redeem sequences never over-withdraw, fee caps monotonic 1-365d)
* `mega.test.ts:1` 230 tests (50 entry, 50 exit, 50 mgmt, 20 split, 20 NAV, 20 drift, 30 redeem vault+1M increments)
* `backend-truth.test.ts` 42 tests (event discriminators + Borsh fixtures, Token-2022 multiplier parse, listener upserts + DB-less degradation, schema idempotency, price cache/fallback)
* `waveb-nav-api.test.ts` 45 tests (exact BigInt fixed-point NAV, drift/rounding, performance windows, zap quote legs with mocked fetch, unsigned fee-crank tx, API routes via fake PgLike)
* `tests/foliox_math.test.ts:1` 1 legacy

Total **552 tests passing** (`cargo test: 178 + backend vitest: 373 + root legacy: 1`). See `backend/tests/` + `programs/*/src/lib.rs` `#[cfg(test)]`.

**Run:**

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cargo test                          # Rust 178
cargo test -p basket --lib          # 84 basket math
npx --prefix backend vitest run --reporter=verbose   # TS 373
npx tsx backend/src/index.ts        # :3001 health {"ok":true}
bash scripts/e2e.sh                 # validator → whitelist → basket → mint/redeem → fee crank (needs solana-test-validator)
```

---

## 14. Commands (Agent Cheat Sheet)

```bash
# Install (once)
brew install rustup && rustup toolchain install stable
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1
sh -c "$(curl -sSfL https://release.solana.com/v1.18.17/install)" # solana 1.18.17

# Build & test (verified)
cargo check                         # 0 errors, 14 warnings anchor-debug
cargo build                         # dev build (SBF needs Agave 2.x due edition2024)
cargo test                          # 178 Rust tests
npm --prefix backend install && npx --prefix backend vitest run  # 373 TS tests
npx tsx backend/src/index.ts        # API :3001
npm --prefix app install && npm --prefix app run dev  # Next.js :3000

# E2E (needs validator)
solana-test-validator --reset &
anchor deploy --provider.cluster localnet
node scripts/createWhitelist.ts
node scripts/createBasket.ts        # nonce, 3 xStocks, 50/30/20, 100/50/200 bps, seed 500/300/200
node scripts/mintAndRedeem.ts
node scripts/accrueFee.ts

# Deploy (after cso + review-and-iterate)
anchor deploy --provider.cluster devnet
curl -fsSL https://www.solana.new/setup.sh | bash -s -- --update  # update superstack skills
```

**Env (`backend/.env.example:1`):**

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/foliox
REDIS_URL=redis://localhost:6379
RPC_URL=https://api.devnet.solana.com
HELIUS_API_KEY=
PROGRAM_WHITELIST=FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS
PROGRAM_FACTORY=3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF
PROGRAM_BASKET=6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k
PORT=3001
```

---

## 15. Agent Workflow — Do / Don't

**DO:**

* Read `docs/foliox-v0-spec.md` first for any math/account question — it has numbers (e.g., `docs/foliox-v0-spec.md:349` mint example).
* Use `math::` helpers in `basket` program and `backend/src/workers/feeMath.ts:4` / `navEngine.ts:7` — do not reimplement formulas.
* Keep `redeem_in_kind` oracle-free and permissionless; if you touch it, ensure no new account is required beyond `basket`, `share_mint`, `user`, `user_share_ata`.
* Keep `Basket` immutable — never add `update_basket` ix.
* For frontend, mirror on-chain validations (2-20, sum 10k, caps) and show legal checkboxes before deploy.
* For Token-2022, store raw, display scaled — never multiply raw by multiplier in program CPI.
* Run `cargo test` + `vitest run` after every change touching math/fees.
* Use superstack skills: `/scaffold-project` for stack decisions, `/build-defi-protocol` for CPI patterns, `/cso` for security scan, `/review-and-iterate` before mainnet, `/navigate-skills` to find MCPs (36 MCPs: Helius, Jupiter, etc. in `solana-skills.json`).

**DON'T:**

* Don't add leverage, lending, derivatives, rebasing, or off-chain custody.
* Don't gate redeem on whitelist/oracle/backend/paused — `paused` is mint-only.
* Don't change program IDs without updating `Anchor.toml:5` + `declare_id!` in all 3 `lib.rs:3`.
* Don't use floating point for on-chain math — use `u128` intermediate then cast to `u64` floor.
* Don't describe baskets as ETFs in UI copy — `LEGAL_REVIEW_REQUIRED` if you touch `app/app/legal/page.tsx:1` or `app/create/page.tsx:1`.
* Don't break tests — 552 tests are your safety net; if you add super many more, run `cargo test` + `npx --prefix backend vitest run`.
* **DON'T use plain HTML / düz `recharts` / `shadcn` chart** — her chart `bklit` (`https://bklit.com/docs/installation`) olmalı. `plain HTML` görünümü yasaktır, her sayfa bklit `Card/Table/Badge` + `AreaChart/BarChart` + `shadcn/tailwind.css` ile yapılmalı.

**When in doubt:** `cargo test -p basket --lib -- tests::test_gross_shares_perfect` and `grep -rn "redeem" docs/foliox-v0-spec.md`.

---

## 16. 90-Day Milestones (Spec §13)

| Phase | Days | Deliverable | Exit |
|-------|------|-------------|------|
| P0 Spec | 1-3 | Spec approved (this doc) | All §1-12 triaged |
| P1 Scaffold | 4-8 | Anchor workspace + CI `cargo test` | `anchor build` + PDAs on localnet |
| P2 Whitelist | 9-14 | `whitelist` + fixture mints | pause not blocking redeem test green |
| P3 Factory | 15-22 | `create_basket` atomic seed, genesis 1M | E2E localnet 3 xStocks |
| P4 Mint/Redeem | 23-36 | `mint_in_kind`/`redeem_in_kind`/`accrue` raw, 1% tolerance | Fuzz 3 green, full redeem empty vault |
| P5 Fees & Mult | 37-42 | Fee exhaustive + multiplier 1→2×/0.95× | `review-and-iterate` pass |
| P6 Indexer | 43-55 | listener + holdings + NAV + price (Jupiter) + pg schema | NAV chart populated |
| P7 API | 56-62 | REST 11 routes + ws | Frontend fetches explore/detail |
| P8 Frontend | 63-75 | wizard 6 steps + buy/redeem + portfolio + legal | Playwright e2e |
| P9 E2E | 76-82 | `scripts/e2e.sh` validator → 2 baskets → 3 users mint/redeem → fee crank → UI smoke | `npm run e2e` deterministic |
| P10 Security | 83-88 | `cso` + `review-and-iterate` + external, legal final, devnet | P0/P1 checked, STRIDE, audit filed |
| P11 Devnet→Mainnet | 89-90 | devnet verified, multisig disclose, `deploy-to-mainnet` checklist | go/no-go mainnet-beta |

Post-90: mainnet-beta capped TVL, bug bounty, QEDGen formal verification if `review-and-iterate` flags invariants.

---

## 17. Glossary

* **Basket / strategy basket:** Immutable vault holding 2-20 whitelisted xStocks, with share token.
* **xStock:** Backed Finance Token-2022 mint representing tokenized equity, with `ScaledUiAmountConfig` multiplier.
* **Raw:** `u64` on-chain amount (`TokenAccount.amount`), used for `transfer_checked`.
* **Scaled:** `raw × multiplier` for display/NAV (`holdingsSync.ts:14`, `lib/solana.ts:7`).
* **bps:** basis points, 1/10000 (e.g., 100 bps = 1%).
* **Genesis 1M:** First basket mint fixed at `1_000_000` shares (6 decimals = 1.0 share) to prevent inflation attack (`basket/src/lib.rs:9`).
* **Drift:** `actual_weight_bps - target_weights_bps` where `actual = scaled_i/Σscaled*10000` (`navEngine.ts:7`).
* **Indexer convenience only:** Backend may be down, redeem still works via direct RPC.

---

## 18. References

* `docs/foliox-v0-spec.md:1` — full 13-section spec with numbers, SQL, API table, page map, test plan, security/legal checklists
* `foliox_build_prompt.md:1` — original prompt (thesis, 9 constraints, 4 programs, fee caps 300/100/300, 90/10 split, stack)
* `~/.agents/skills/data/solana-knowledge/03-contract-level.md:1` — PDAs, Anchor patterns
* `~/.agents/skills/data/guides/security-checklist.md:1` — P0/P1 audit with `grep` commands
* Backed xStocks Token-2022 docs (Scaled UI Amount extension)
* Jupiter Price/Swap APIs (`price.jup.ag/v6/price`, `/quote`, `/swap`)

---

*Generated for agents by superstack (solana.new) + FolioX architect. Keep this file updated when `docs/foliox-v0-spec.md` changes. Last updated: 2026-09-01 (implementation waves) — **178 Rust + 373 backend TS (+1 legacy) tests passing; protocol/backend/frontend implemented — see plan.md §8**.*

---

## 19. File-Level Quick Reference (Every Key File)

| File | Lines | Purpose |
|------|-------|---------|
| `programs/whitelist/src/lib.rs:1` | 269 | `WhitelistConfig` + `WhitelistedMint` structs, 5 ix + 13 tests |
| `programs/basket_factory/src/lib.rs:1` | 308 | `FactoryConfig` + `Basket` alias, 2 ix + 17 tests |
| `programs/basket/src/lib.rs:1` | 700+ | `Basket` + `math` module 6 fns + 3 ix + 84 tests + 40 mega_tests |
| `backend/src/db/schema.sql:1` | 90 | 8 tables + 2 indexes + 1 view |
| `backend/src/indexer/listener.ts:1` | 35 | `EventListener` class, poll `getSignaturesForAddress` |
| `backend/src/indexer/holdingsSync.ts:1` | 30 | `fetchMultiplier`, `syncHoldings` raw→scaled |
| `backend/src/workers/navEngine.ts:1` | 35 | `computeNav`, `computeSharePrice`, `computeDrift` |
| `backend/src/workers/feeMath.ts:1` | 18 | 4 fee fns + 2 constants |
| `backend/src/workers/priceFetch.ts:1` | 30 | `fetchPrices` + `mockPrices` |
| `backend/src/api/server.ts:1` | 60 | mock handler for 4 routes, CORS |
| `backend/src/index.ts:1` | 15 | entrypoint `PORT=3001` |
| `backend/tests/*.ts` | 800+ | 373 tests (foliox 34, super.integration 22, mega 230, backend-truth 42, waveb-nav-api 45) |
| `app/app/*.tsx` | 200+ | 9 pages |
| `Anchor.toml:1` | 29 | program IDs + cluster |
| `Cargo.toml:1` | 18 | workspace + overflow-checks |
| `scripts/e2e.sh:1` | 25 | deterministic flow |

Use `read` tool on these before editing — they are authoritative.

---

## 20. Troubleshooting for Agents

| Symptom | Cause | Fix |
|---------|-------|-----|
| `anchor build` → `edition2024` error | platform-tools `rustc 1.75` too old for latest `crypto-common` | Use `cargo check`/`cargo test` for verification; SBF needs Agave 2.x or `cargo update --pin` older deps. Documented `README.md:13` |
| `Cargo.lock version 4 requires -Znext-lockfile-bump` | Solana cargo 1.75 vs lockfile 4 | `sed -i '' 's/version = 4/version = 3/' Cargo.lock` then `anchor build`, or delete lockfile and `cargo generate-lockfile` |
| `WeightMismatch` on mint | deposits off-target >1% | Check `D*S/V` for each constituent, ensure deposits proportional to `V` (which tracks actual holdings, not target weights) |
| `ZeroShares` | dust deposit `D*S/V == 0` | Increase deposit or vault must have non-zero holdings; genesis uses fixed 1M |
| `InsufficientShares` on redeem | `burn > user_share_ata.amount` | Query `getTokenAccountBalance` for share ATA first |
| Backend `price fetch failed` | Jupiter API down | `mockPrices` fallback 0/100 in `priceFetch.ts:20`, indexer still computes holdings |
| Frontend `fetch failed` | backend not running | `npx tsx backend/src/index.ts` must be on `:3001`, check `NEXT_PUBLIC_API` env |

---

## 21. FAQ for New Agent Session

**Q: Where do I start if user says "add X feature"?**  
A: Check `docs/foliox-v0-spec.md:1` for whether X violates V0 constraints (leverage/rebasing/pausing redeem). If not, add instruction with validation + `#[cfg(test)]` + backend `feeMath`/`navEngine` helper + frontend page + `cargo test` + `vitest`.

**Q: User wants leverage?**  
A: Refuse per §2 constraint #2; suggest V2 vault wrapper separate program that holds basket shares as collateral, never modify core `basket` program.

**Q: How to add new xStock?**  
A: `add_mint` via `whitelist` program `whitelist/src/lib.rs:21` then update `backend/src/db/schema.sql` `whitelisted_mints` and frontend `create/page.tsx` fetch.

**Q: How to change fees?**  
A: Factory caps immutable; only `entry/exit/mgmt` per basket at `create_basket` time, validated `≤ cap`. No update ix — must deploy new basket version.

**Q: Where is genesis inflation protection tested?**  
A: `basket/src/lib.rs:330` `test_genesis_fixed_shares` + `factory` seed>0 check `basket_factory/src/lib.rs:62` + `README.md:62` security note.

**Q: How to run only basket math tests quickly?**  
A: `cargo test -p basket --lib -- mega_tests` or `cargo test -p basket -- tests::test_gross_shares_perfect`.

---

## 22. Quick Start for New Agent (Copy-Paste)

```bash
# 1. Read context (you are here)
cat AGENTS.md
cat docs/foliox-v0-spec.md | head -n 100

# 2. Verify toolchain
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
rustc --version; solana --version; anchor --version

# 3. Run tests (should be 178 + 373 green before any edit)
cargo test
npx --prefix backend vitest run --reporter=verbose

# 4. Make change (example: add new fee cap check)
# - edit programs/basket/src/lib.rs
# - add #[cfg(test)] case
# - run cargo test -p basket
# - update backend/src/workers/feeMath.ts if needed
# - run npx vitest run

# 5. Run backend locally
npx tsx backend/src/index.ts # :3001
curl http://localhost:3001/api/v1/health # {"ok":true}

# 6. Run frontend
npm --prefix app install && npm --prefix app run dev # :3000
```

Always keep `AGENTS.md` in sync with `docs/foliox-v0-spec.md` when spec changes.

---

## 23. How This File Is Used by Tools

* **Opencode** reads `AGENTS.md` at session start (via `opencode` plugin `~/.config/opencode/opencode.jsonc:1`).
* **Claude Code** reads `CLAUDE.md` (copy of this) and `~/.claude/skills/SKILL_ROUTER.md:1` for routing.
* **Cursor/Codex** reads `CONTEXT.md` fallback.
* `scaffold-project` skill writes `.superstack/idea-context.md` → this file tells next agent how to continue; never delete `.superstack/`.
* `cso` skill scans `programs/**/*.rs` via this file's paths; `review-and-iterate` uses §11 checklist.

If you add a new program or page, update §4 structure + §19 table + `Anchor.toml:5` in this file.

---

## 24. Current Verified State and Coordination Log (2026-09-01)

The current repository is a scaffold/prototype, not localnet-ready or production-ready. A fresh Orca supervised discovery Run `run_b38cb1bbcd0c` completed with three read-only workers; no source files were changed in that run. Full findings and the implementation order are in `docs/ui-discovery-2026-09-01.md` and `plan.md`.

Verified facts:

* Rust `cargo test --workspace`: 178 passed.
* Backend Vitest: 373 passed; the root legacy test adds 1, so the combined TypeScript total is 374.
* App production build passes only because `app/next.config.js` ignores type/lint errors; strict app TypeScript still fails.
* Backend strict build still fails NodeNext relative-import and implicit-any errors.
* Protocol instruction bodies still contain stubbed transfer/mint/burn/fee behavior; math unit tests do not prove localnet correctness.
* Backend baskets/zap/multiplier/indexer paths remain empty, mock, or incomplete; wallet packages are installed but not wired.
* The app has an `@bklit` registry entry, but the current chart tree is local `@visx` code and the local Brush adapter is explicitly a placeholder. Verify registry provenance before claiming full Bklit compliance.
* All project files are currently untracked in Git; preserve the worktree and create a safe baseline before implementation edits. Never reset or clean it as part of routine work.

Coordination rules for the next wave:

1. Resolve the G0 brand and telemetry decisions in `plan.md` before writing frontend components.
2. Resolve Bklit registry provenance and the Brush strategy before chart migration.
3. Build shared tokens, shell, wallet state, and strict type/build health before parallel page polish.
4. Never let multiple workers edit `globals.css`, shared chart primitives, wallet providers, or the same route concurrently.
5. Do not mutate the older UI Run `run_7f4b8dbc5e4f`; use a fresh Task/Dispatch under the current Run for follow-up work.

*End of AGENTS.md — Last verified 2026-09-01 (implementation waves complete) with Rust 178, backend Vitest 373, root legacy TypeScript 1, all release gates per plan §6 evidenced PASS; localnet E2E attempt in flight — see `plan.md`.*
