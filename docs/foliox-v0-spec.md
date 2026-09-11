# FolioX V0 — Implementation-Ready Spec

> Status: **Draft V0 — READY FOR CODE** | Stack: Anchor + Next.js + TypeScript Backend | Date: 2026-09-01 | Author: FolioX Architect
> Source: `foliox_build_prompt.md` (xStocks strategy baskets, Solana-first, no-ETF language)

---

## 1. System Architecture (Text Diagram)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CLIENT LAYER                                                               │
│  Next.js 15 + Tailwind + shadcn/ui + @solana/wallet-adapter + @solana/web3 │
│  + @solana/spl-token (Token-2022) + Jupiter Swap API (quote → tx)          │
│  Pages: Landing / Explore / Basket Detail / Buy / Redeem / Create Wizard   │
│         / Creator / Portfolio / Legal Modal                                 │
│  Reads: RPC (Helius/Triton) direct for holdings + Backend API for NAV/rank │
└─────────┬───────────────────────────┬───────────────────────────────────────┘
          │ direct RPC (holdings)     │ REST/tRPC (NAV, rankings, quotes)
          ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BACKEND / INDEXER  (Node.js 20 + TypeScript + PostgreSQL 15 + Redis + BullMQ) │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Event       │  │ Holdings     │  │ Multiplier   │  │ Jupiter Quote│      │
│  │ Listener    │→ │ Sync Worker  │→ │ Reader       │  │ Service      │      │
│  │ (Helius DAS │  │ (getTokenAcc │  │ (getAccount  │  │ (build zap-  │      │
│  │  + Geyser / │  │  byOwner +  │  │  Scaled UI   │  │  in/out legs │      │
│  │  websockets)│  │  parse Token │  │  extension)  │  │  → sequential│      │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  │  swaps + mint│      │
│         │ events         │ token balances  │ multiplier│  quote cache)│      │
│         └────────┬───────┴────────┬────────┴──────────┴──────┬───────┘      │
│                  ▼            ▼                              │              │
│          ┌──────────────┐ ┌────────┐  ┌──────────────┐       │              │
│          │ PostgreSQL   │ │ Redis  │  │ NAV Engine   │◄──────┘              │
│          │ (see §7)     │ │ (cache,│  │ NAV = Σ(scaled*price)             │
│          │ snapshots,   │ │  queue)│  │ sharePrice=NAV/supply               │
│          │ rankings)    │ │        │  │ drift, perf calc                   │
│          └──────┬───────┘ └────────┘  └──────┬───────┘                      │
│                 │                            │ snapshot cron (1m/1h)         │
│                 └────────────┬───────────────┘                              │
│                              ▼                                              │
│                      REST/tRPC API (see §8) — convenience only              │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ indexer reads only, never custodies
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SOLANA PROGRAMS (Anchor 0.30 + SPL Token-2022) — SOURCE OF TRUTH         │
│                                                                             │
│  Program 1: `whitelist`  (admin/ governance)                                │
│  ┌────────────┐  ┌──────────────┐                                           │
│  │ Whitelist  │──│ Whitelisted  │── status: Active | PausedNewMints        │
│  │ Config     │  │ Mint × N     │   paused ≠ paused redeem `LEGAL_REVIEW_REQUIRED` │
│  └────────────┘  └──────────────┘                                           │
│                                                                             │
│  Program 2: `basket_factory`  (permissionless create)                       │
│  Validates 2-20 whitelisted mints, weights sum 10_000, fee caps,            │
│  creates Basket PDA, share Mint PDA, vault ATAs, collects seed deposit      │
│  atomically. Emits BasketCreated.                                           │
│                                                                             │
│  Program 3: `basket`  (holds xStocks, mints/redeems share token)            │
│  ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐                       │
│  │ Basket      │ │ Vault ATA    │ │ BasketShareMint │                       │
│  │ (PDA)       │→│ per xStock   │ │ (Token-2022,    │                       │
│  │ immutable   │ │ (PDA-owned)  │ │  authority=PDA) │                       │
│  │ metadata    │ └──────────────┘ └─────────────────┘                       │
│  │ weights, fees│  supports mint_in_kind / redeem_in_kind / accrue_fee     │
│  └─────────────┘  Emits Minted / Redeemed / FeeAccrued                      │
│                                                                             │
│  Program 4 (optional periphery): `zap_router` OR client-sequential swaps    │
│  V0: client Jupiter swaps + in_kind mint (documented atomicity tradeoff).  │
│  On-chain router MUST NOT custody user funds beyond one ix.                 │
│                                                                             │
│  Token-2022 xStocks mints (external, e.g.,Backed Finance)                   │
│   -> raw balance on-chain, multiplier via Scaled UI Amount extension        │
│   -> Backend computes scaled = raw * multiplier, programs use raw          │
└─────────────────────────────────────────────────────────────────────────────┘
         ▲ Jupiter Swap API (off-chain quote, built in backend/frontend)
         │ Price feeds: for NAV only (Pyth/Switchboard/Jupiter price API)
         │   MUST NOT gate redeem (constraint #4)

Data flows:
- Create: Creator → factory::create_basket + seed deposit (atomic) → BasketCreated event → indexer indexes
- Buy in-kind: User → basket::mint_in_kind (transfers raw xStocks → vault ATAs) → mints shares net-of-entry-fee
- Redeem: User → basket::redeem_in_kind (burns shares → pro-rata raw xStocks out, exit fee to creator/treasury, management fee accrued first)
- Zap-in: Frontend → backend /quote/zap-in (Jupiter legs) → client executes swaps → then mint_in_kind (V0 sequential); zap-out symmetric
- NAV: Indexer cron reads vault ATAs + multiplier + external price → snapshots → API
```

**Assumptions flagged:**
- `LEGAL_REVIEW_REQUIRED`: xStocks are Token-2022 Scaled UI Amount mints issued by Backed/xStocks issuer. We assume issuer exposes multiplier via `ScaledUiAmountConfig` extension (multiplier u64 with decimals). If issuer uses different extension (e.g., TransferFee), adapt reader.
- Jupiter price API used for NAV convenience only; Basket `redeem_in_kind` never reads oracle.
- `Backed` xStocks whitelist initially governed by multisig; V0 governance single key (upgrade to DAO later) `LEGAL_REVIEW_REQUIRED`.

---

## 2. Solana Account Model

### 2.1 PDA Seeds & Authorities

All PDAs derived from respective program IDs.

| Account | Seeds | Authority | Notes |
|---------|-------|-----------|-------|
| `WhitelistConfig` | `b"config"` | whitelist program | singleton |
| `WhitelistedMint` | `b"mint", mintPubkey` | whitelist program | one per xStock mint |
| `FactoryConfig` | `b"factory"` | basket_factory program | holds treasury, split, caps |
| `Basket` | `b"basket", factory.key(), creator.key(), nonce (u64)` | `basket` program PDA `b"basket", basket.key()` | nonce avoids creator collisions |
| `BasketShareMint` | `b"share_mint", basket.key()` | PDA `b"basket", basket.key()` | Token-2022 mint, decimals 6 `ASSUMPTION` |
| `VaultATA` (per constituent i) | ATA: `AssociatedToken::derive( basket_pda, mint_i )` | basket PDA | one Token-2022 token account per constituent, owned by basket PDA |
| `VaultAuthority` | `b"basket", basket.key()` | basket program | signer for CPI transfers/burns/mints |

`Anchor` size calculations include 8-byte discriminator.

### 2.2 Account Structs (Rust)

```rust
// whitelist program
#[account]
pub struct WhitelistConfig {
    pub authority: Pubkey,          // governance pubkey
    pub pending_authority: Option<Pubkey>, // 2-step transfer
    pub mint_count: u32,
    pub bump: u8,
    // 32+1+4+1+8 = 46 + 8 disc = 54
}

#[account]
pub struct WhitelistedMint {
    pub mint: Pubkey,               // xStock Token-2022 mint
    pub decimals: u8,               // cached at whitelist time (from mint)
    pub multiplier_watermark: u64,  // last seen multiplier (for monitoring, not gate)
    pub status: WhitelistStatus,    // Active | PausedNewMints
    pub price_source: String,       // max 64 chars: "jupiter:TSLAx" etc.
    pub bump: u8,
}
pub enum WhitelistStatus { Active, PausedNewMints }

// factory program
#[account]
pub struct FactoryConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,           // fee recipient
    pub creator_fee_split_bps: u16, // e.g. 9000 = 90% creator
    pub entry_fee_cap_bps: u16,     // 300
    pub exit_fee_cap_bps: u16,      // 100
    pub management_fee_cap_bps: u16,// 300 / year
    pub basket_count: u64,
    pub bump: u8,
}

#[account]
pub struct Basket {
    pub factory: Pubkey,
    pub creator: Pubkey,
    pub treasury: Pubkey,
    pub share_mint: Pubkey,         // Token-2022
    pub nonce: u64,
    pub created_at: i64,            // unix ts
    pub last_fee_accrual_ts: i64,
    pub metadata_hash: [u8; 32],    // SHA256 of off-chain metadata (name, desc, image)
    pub num_constituents: u8,       // 2..20
    pub constituents: [Pubkey; 20], // only first n valid, rest Pubkey::default
    pub target_weights_bps: [u16; 20], // sum 10_000
    pub entry_fee_bps: u16,         // 0..300
    pub exit_fee_bps: u16,          // 0..100
    pub management_fee_bps: u16,    // 0..300 annualized
    pub total_minted_shares: u64,   // raw share supply at creation (optional cache)
    pub bump: u8,
    pub vault_bump: u8,
    // immutable: constituents, weights, fees, creator, metadata_hash, treasury at creation
    // Size: ~ 32*3+8+8+8+32+1+32*20+2*20+2*3+8+1+1 ≈  820 + disc
}
```

**Constraints:**
- `Basket` immutable after `create_basket` — no update instruction exists (enforces V0 constraint #1).
- Governance `WhitelistConfig::authority` can `pause_new_mints` but no instruction can set `Basket` to pausable redeem — redeem path has no `Paused` check.
- `FactoryConfig::creator_fee_split_bps` + treasury split = 10_000.

### 2.3 Token Accounts

- Vault ATAs: `AssociatedTokenAccount` for each constituent mint, owned by `basket PDA`. Created in `create_basket` via `create_associated_token_account` CPI if not exists.
- User token accounts: validated `owner == signer` and `mint == expected`, with `is_initialized` check. Prevent malicious `AccountInfo` substitution (see §11).

### 2.4 Events (Anchor `emit!`)

```rust
#[event] pub struct BasketCreated { pub basket: Pubkey, pub creator: Pubkey, pub num_constituents: u8, pub share_mint: Pubkey, pub ts: i64 }
#[event] pub struct Minted { pub basket: Pubkey, pub user: Pubkey, pub gross_shares: u64, pub net_shares: u64, pub entry_fee_shares: u64 }
#[event] pub struct Redeemed { pub basket: Pubkey, pub user: Pubkey, pub shares_burned: u64, pub exit_fee_shares: u64 }
#[event] pub struct FeeAccrued { pub basket: Pubkey, pub shares_minted: u64, pub elapsed_sec: u64 }
```

---

## 3. Instruction List (Arguments & Validations)

### 3.1 Whitelist Program

| Ix | Args | Validations | Auth |
|----|------|-------------|------|
| `init_config` | — | `config` not exists, sets `authority = signer` | signer |
| `add_mint(mint: Pubkey, decimals: u8, price_source: String)` | mint, decimals 0-12, source len≤64 | mint is Token-2022, `decimals` matches `Mint::decimals`, `mint` not already whitelisted, `status=Active` | `authority` signer |
| `pause_mint(mint: Pubkey)` | — | `WhitelistedMint` exists, `status Active → PausedNewMints` | authority |
| `unpause_mint(mint: Pubkey)` | — | reverse | authority |
| `transfer_authority(new_authority: Pubkey)` | 2-step | only pending can claim | authority |
| `claim_authority` | — | `signer == pending_authority` | pending |

No `remove_mint` in V0 — keeps history; paused suffices. Remove would brick existing baskets `LEGAL_REVIEW_REQUIRED`.

### 3.2 Basket Factory Program

```
create_basket(
  nonce: u64,
  constituents: Vec<Pubkey> (2..20),
  weights_bps: Vec<u16> (same len),
  entry_fee_bps: u16,
  exit_fee_bps: u16,
  management_fee_bps: u16,
  metadata_hash: [u8;32],
  seed_amounts: Vec<u64>  // raw amounts per constituent, proportional to weights
)
```

**Validations (all enforced, atomically):**
1. `constituents.len() == weights_bps.len() == seed_amounts.len()`, `2 ≤ len ≤ 20`
2. No duplicate mints
3. `Σ weights_bps == 10_000`
4. Each `mint` has `WhitelistedMint { status == Active }` (CPI read or PDA check via `whitelist` program's account)
5. `entry_fee_bps ≤ FactoryConfig.entry_fee_cap_bps` (300), `exit ≤100`, `management ≤300`
6. `metadata_hash != [0;32]` (require IPFS/Arweave hash exists off-chain)
7. `FactoryConfig.basket_count +1` not overflow
8. **Creator seed deposit atomically:** `seed_amounts[i] > 0` for all i, transfer `seed_amounts[i]` raw from `creator_token_ata[i]` → `vault_ata[i]` via CPI (`transfer_checked`). No basket can be created empty → prevents hijack (constraint #7 in §11).
9. Creates `Basket` PDA, `ShareMint` PDA (Token-2022, `mint_authority = basket PDA`, `decimals=6`), vault ATAs.
10. Initializes `share_mint.supply = 0` then mints initial shares to creator: `initial_shares = Σ seed_amounts_scaled ?` — see §5 for initial shares = `1_000_000` (1.0 share with 6 decimals) if seed proportional; alternatively `gross_shares = sum_raw?` Fix: use `NET_SHARES = 1_000_000` for first depositor to prevent inflation attack; deposit amounts define basket's initial backing ratio (not 1:1 USDC). Store `last_fee_accrual_ts = Clock::get().unix_timestamp`.
11. Emits `BasketCreated`.

**Accounts:** `payer/creator (signer, mut)`, `factoryConfig (mut)`, `whitelistConfig (read)`, `Basket (init)`, `ShareMint (init)`, `WhitelistedMint[] (read)`, `vault_atas[] (init_if_needed)`, `creator_atas[] (mut)`, `token_program = Token2022`, `system, associated_token, sysvar`.

No `update_basket` instruction exists.

### 3.3 Basket Program

#### `mint_in_kind`
```
mint_in_kind(
  amounts: Vec<u64> // raw per constituent, must be >0, len == basket.num_constituents
)
```
Validations:
- `basket.num_constituents == amounts.len()`
- Each `amount >0`
- For each i: `WhitelistedMint.status != Removed` (paused still allows? V0: paused **does** block mint — checks `Active` only, redeem exempt)
- Transfer `amounts[i]` raw from `user_ata[i]` → `vault_ata[i]` via `transfer_checked` with correct `mint`, `decimals`
- Compute `gross_shares` to mint (see §5)
- Accrue management fee first (see `accrue_management_fee` internal)
- Deduct entry fee: `entry_fee_shares = floor(gross_shares * entry_fee_bps / 10_000)`
- Mint `gross_shares - entry_fee_shares` to user, `entry_fee_shares` split 90/10 to creator/treasury ATAs of share mint (create ATA if needed)
- Emit `Minted`

No oracle, no pauser.

#### `redeem_in_kind`
```
redeem_in_kind(
  shares_to_burn: u64
)
```
Validations:
- `shares_to_burn >0` and `≤ user_share_balance`
- `shares_to_burn < total_supply`? Allow full redeem except dust — if `shares_to_burn == total_supply` → pro-rata is 100% of vault (must work, tests cover)
- Accrue management fee first (checkpoint)
- Compute exit fee: `exit_fee_shares = floor(shares_to_burn * exit_fee_bps / 10_000)`
- Effective burned shares for pro-rata = `shares_to_burn - exit_fee_shares` ? Design: fee paid **in shares** — portion of redeemed shares transferred to fee recipients instead of burned. So fee recipients receive `exit_fee_shares` (split), remaining `shares_to_burn - exit_fee_shares` is burned via `burn`. Pro-rata entitlement computed on `shares_to_burn` (pre-fee) or post-fee? Spec: `Fee model: exit fee = portion of redeemed shares transferred` — so entitlement for exit fee recipients is shares, not underlying. Underlying returned = `floor(vault_raw[i] * (shares_to_burn - exit_fee_shares) / total_supply_before)`. Simplifies: burned shares determine underlying out; fee shares don't map to underlying out, they stay as share supply to fee recipients. Need crisp math — see §6.
- For each constituent i: `amount_out_i = floor(vault_raw[i] * shares_to_burn / total_supply_before)`? Wait need split fee: If fee shares remain as supply, then underlying attributable to fee shares stays in vault (fee recipients hold shares). So user gets proportional to burned portion only. We implement `burn_amount = shares_to_burn - exit_fee_shares` for vault math, then transfer fee shares.
- Transfer `amount_out_i` raw from vault ATA → user ATA via `transfer_checked` with PDA signer seeds.
- Burn `burn_amount` from user share ATA via `burn` CPI (authority = user signer? Actually burn requires owner authority = user signer; we verify `user is signer` and `user_share_ata.owner == user`).
- Transfer `exit_fee_shares` via `transfer` from user share ATA → creator_share_ata / treasury_share_ata (split) — requires user as authority signer.
- Emit `Redeemed`
- **Never gated** by whitelist status, oracle, backend, or `paused` flag. Always succeeds if math valid.

#### `accrue_management_fee` (permissionless, cranks)
```
accrue_management_fee()
```
- Anyone can call; computes `elapsed = now - basket.last_fee_accrual_ts`, `fee_shares = floor(total_supply * management_fee_bps * elapsed / (10_000 * SECONDS_PER_YEAR))`
- Split fee_shares to creator/treasury via `mint_to` (dilution) — increases supply, dilutes existing holders
- Update `last_fee_accrual_ts = now`, emit `FeeAccrued`
- Called internally at top of `mint_in_kind` and `redeem_in_kind` (and externally by keeper/indexer every hour/day)
- Caps: `management_fee_bps ≤300`, property test ensures never exceeds cap over elapsed time even with repeated cranks.

No `withdraw` / `admin_withdraw` exists.

#### Optional `zap_router` — V0 client-sequential path documented:
- Backend `/quote/zap-in` returns Jupiter swap legs + expected `amounts[]` slippage.
- Frontend executes swaps sequentially, then `mint_in_kind`. Atomicity tradeoff: if swaps partial-fill or fail, user holds intermediate tokens; no funds lost but extra txs needed. On-chain atomic zap via CPI to Jupiter would require Jupiter CPI and MEV risk — deferred to V1.

---

## 4. Token-2022 / Scaled UI Amount Accounting Plan

**Goal:** `constraint #6-7`: store raw, display scaled, never confuse.

### 4.1 xStock Mint Assumptions
- All xStocks are **SPL Token-2022** mints with optional extensions: `ScaledUiAmountConfig` (multiplier), possibly `TransferFee`.
- `Raw amount` = `u64` stored in `TokenAccount.amount` and used for `transfer_checked(amount, decimals)` — **programs use raw only**.
- `Scaled amount` = `raw * multiplier` where multiplier is fixed-point with `multiplier_decimals` (Backed uses `multiplier = 1.0` initially, updates on splits/dividends). Read via `getAccount` extension data or `getTokenAccount` RPC `scaledUiAmount`.

### 4.2 On-Chain Read Strategy
- Programs **do not** read multiplier for transfers — they transfer raw, ignoring extension. They only store `decimals` cached in `WhitelistedMint`.
- For validation, whitelist `add_mint` fetches `Mint` data via `Token-2022` CPI or off-chain script that reads `decimals` + extension presence; stores `decimals`.
- Programs use `transfer_checked` with `decimals` from whitelist to ensure mint match, avoiding decimal mismatch exploit.

### 4.3 Off-Chain (Indexer/UI) Read
```ts
// helper: fetch multiplier
const acc = await connection.getAccountInfo(mintPubkey);
const mint = unpackMint(mintPubkey, acc, TOKEN_2022_PROGRAM_ID);
const scaledExt = getScaledUiAmountConfig(mint); // if present
const multiplier = scaledExt ? scaledExt.multiplier / 10**scaledExt.decimals : 1;
// scaledBalance = Number(raw) * multiplier / 10**decimals  (display)
```
- Indexer `holdings_sync` reads each vault ATA raw amount, reads mint multiplier, computes `scaled = raw * multiplier`, then NAV.
- Frontend `useBasketHoldings` does same; shows both raw (debug) and scaled (display) with `formatNumber` (`number-formatting` skill).

### 4.4 Tests for Multiplier Changes
- Mock Token-2022 mints with `ScaledUiAmountConfig { multiplier: 1_000_000 (6 dec) }` then update to `2_000_000` (2x split).
- Assert: `raw` stays 1_000_000, `scaled` doubles from 1.0 → 2.0, program `redeem_in_kind` still transfers same raw (pro-rata raw math unchanged), UI NAV doubles only if price constant (correct).
- Dividend = multiplier <1? Simulate 0.95 multiplier → scaled drops 5%, redeem still raw-pro-rata.

---

## 5. Mint / Redeem Math (with Examples)

### 5.1 Core Invariant
For any basket, at any time: `share i` owns `vault_raw_j * (shares_i / total_supply)` of each constituent j (raw pro-rata). Fees are shares-based dilutions/transfers, not underlying reweighting.

### 5.2 Mint Math (in-kind)
Given `total_supply = S_old` (before accrue), `vault_raw_j = V_j` (before deposit), user deposits `amounts_j = D_j` raw.

1. Accrue mgmt fee → `S = S_old + fee_shares_minted` (steps in §6)
2. If `S == 0` (genesis, only `create_basket` path): `gross_shares = 1_000_000` (1 share) `ASSUMPTION` — initial deposit defines backing; prevents division by zero. Alternative: `gross_shares = sum(D_j)` would couple to token count — we use fixed genesis shares to avoid inflation attack vector (see §11). If subsequent mint with `S>0`, proceed:
3. Compute `gross_shares_j = D_j * S / V_j` for each j, then `gross_shares = min_j(gross_shares_j)` — ensures min across constituents (enforces weight adherence; if user deposits off-target weights, limiting constituent determines shares). Example off-target deposit penalizes to basket.
   Strict V0: require `D_j * S / V_j` identical across all j within 1% tolerance else revert with `WeightMismatch` — prevents drift gaming. **Chosen:** revert if `max(gross_shares_j) - min(gross_shares_j) > 0.01 * min` (1%).
4. `entry_fee_shares = floor(gross_shares * entry_fee_bps / 10_000)`
5. `net_shares = gross_shares - entry_fee_shares` minted to user, `entry_fee_shares` split to creator/treasury.

**Example 1 — Perfect weight deposit:**
- Basket: TSLAx, NVDAx, AAPLx, weights 50/30/20, `entry 100 bps (1%)`
- State: `S=10_000_000` (10 shares), `V_TSLA=500_000_000` (500), `V_NVDA=300_000_000`, `V_AAPL=200_000_000` (6 dec)
- User deposits `D_TSLA=50_000_000` (50), `D_NVDA=30_000_000`, `D_AAPL=20_000_000` (exactly 50/30/20)
- `gross_shares_TSLA = 50 *10 /500 =1_000_000`, similarly 1_000_000 for all → `gross=1_000_000`
- `entry_fee=10_000` (1%), `net=990_000` minted to user (0.99 shares).

**Example 2 — Off-weight deposit (reverted):**
- Same basket, user deposits `D_TSLA=60_000_000`, `D_NVDA=30_000_000`, `D_AAPL=10_000_000`
- `gross_TSLA=1_200_000`, `gross_NVDA=1_000_000`, `gross_AAPL=500_000` → min=500_000, max-min=700_000 >1% → `WeightMismatch` error.

**Example 3 — Genesis (create_basket):**
- Seed `D_TSLA=100_000_000`, `D_NVDA=60_000_000`, `D_AAPL=40_000_000`, `S=0` → `gross=1_000_000` minted to creator (ownership 100%).

### 5.3 Redeem Math (in-kind, permissionless)
Given `S_before` (after mgmt fee accrual), user burns `shares_burn = B`.

1. `exit_fee_shares = floor(B * exit_fee_bps / 10_000)`
2. `burn_amount = B - exit_fee_shares` (underlying out computed on `burn_amount` vs total, fee shares stay as supply held by fee recipients)
   Alternatively if spec intends fee on full `B` (our choice) vs on `burn_amount` — we use `B` base for fee, underlying out on `burn_amount`.
3. For each j: `amount_out_j = floor(V_j * burn_amount / S_before)`? Wait need to handle fee remaining: If we burn `B - fee`, then `amount_out = V * (B - fee) / S`. Remaining `V - sum(out)` stays for remaining shares including fee recipients' shares. This is dilution-consistent.
   Example with `S=10_000_000`, `V_TSLA=550_000_000`, `B=1_000_000`, `exit 50 bps (0.5%)` → `fee=5_000`, `burn=995_000`, `out_TSLA = 550_000_000 * 995_000 /10_000_000 = 54_725_000` (54.725 vs perfect 55_000_000). Creator gets 5k shares (~0.05% of supply).

**Example — Full redeem:**
- `S=1_000_000`, single holder burns `1_000_000` with `exit 0` → `out_TSLA = V_TSLA*1/1 = V_TSLA` (full vault, zero remainder, basket empty but not deleted).

Rounding: use `floor` for `amount_out` to avoid over-withdraw; `ceil` for fee shares to not under-charge? We use `floor` for fee (favors user minimally) but property test asserts no over-withdraw.

---

## 6. Fee Math (with Examples)

### 6.1 Fee Types
- **Entry:** `entry_fee_bps` 0..300, one-time on `mint_in_kind`.
- **Exit:** `exit_fee_bps` 0..100, on `redeem_in_kind`.
- **Management:** `management_fee_bps` 0..300 annualized, streamed via `mint_to` dilution.

### 6.2 Split
`FactoryConfig.creator_fee_split_bps = 9000` default → 90% creator, 10% treasury. Configurable per factory (future: per basket override `LEGAL_REVIEW_REQUIRED` — creator fee as securities implication).

Split math:
```rust
let creator_shares = fee_shares * creator_split / 10_000;
let treasury_shares = fee_shares - creator_shares; // remainder to treasury avoids dust loss
```

### 6.3 Management Fee Streaming
```rust
const SECONDS_PER_YEAR: u64 = 365 * 24 * 3600;
let elapsed = now - last_accrual;
if elapsed == 0 { return 0; }
let annual_rate_bps = basket.management_fee_bps as u64; // 300 = 3%
let fee_shares = (total_supply as u128 * annual_rate_bps as u128 * elapsed as u128)
                 / (10_000u128 * SECONDS_PER_YEAR as u128);
fee_shares as u64 // floor
```
Example: `S=10_000_000`, `mgmt 200 bps (2%)`, `elapsed 30 days (2_592_000s)`
`fee =10_000_000 *200 *2_592_000 /(10_000*31_536_000)=10_000_000*518_400_000 /315_360_000_000≈16438` shares (0.164% for 30d, annualized 2%).

**Property:** `fee_shares / S ≤ annual_rate * elapsed / SECONDS_PER_YEAR` (never exceeds cap even with daily cranks) — fuzz test accrues hourly vs yearly lump, asserts equality within rounding 1 share.

**Example timeline:**
- Day 0: `S=10M`, last=0
- Day 30 crank: mints 16,438 split 14,794 creator /1,644 treasury → `S=10,016,438`
- Day 60 redeem with mgmt accrual first → again computes on new `S`.

### 6.4 Fee Tables (for UI)

| Fee | Cap | Example basket (100/50/200 bps) | On 1 share mint (1_000_000 gross) | Treasury split |
|-----|-----|----------------------------------|-----------------------------------|----------------|
| Entry | 300 bps | 100 bps (1%) | fee=10_000, net=990_000 | creator 9_000 / treasury 1_000 |
| Exit  | 100 bps | 50 bps (0.5%) | burn 1M → fee 5_000, burn 995_000 | same |
| Mgmt  | 300 bps/yr | 200 bps/yr | 164/day per 10M supply | continuous mint |

UI must show: `net shares after fees`, `fee apy`, `creator earnings` `LEGAL_REVIEW_REQUIRED`.

---

## 7. Backend Data Model (PostgreSQL)

```sql
-- baskets (immutable core)
CREATE TABLE baskets (
  pubkey TEXT PRIMARY KEY, -- basket PDA
  factory TEXT NOT NULL,
  creator TEXT NOT NULL,
  treasury TEXT NOT NULL,
  share_mint TEXT NOT NULL UNIQUE,
  nonce BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  metadata_hash TEXT NOT NULL,
  metadata_json JSONB, -- off-chain name, desc, image from IPFS
  num_constituents INT NOT NULL CHECK (num_constituents BETWEEN 2 AND 20),
  constituents TEXT[] NOT NULL, -- ordered mint pubkeys
  weights_bps INT[] NOT NULL,   -- ordered, sum 10000
  entry_fee_bps INT NOT NULL,
  exit_fee_bps INT NOT NULL,
  management_fee_bps INT NOT NULL,
  last_fee_accrual_ts TIMESTAMPTZ NOT NULL
);

-- whitelist
CREATE TABLE whitelisted_mints (
  mint TEXT PRIMARY KEY,
  decimals INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Active','PausedNewMints')),
  price_source TEXT,
  multiplier NUMERIC, -- cached
  updated_at TIMESTAMPTZ NOT NULL
);

-- holdings snapshot per basket (updated every 30s or on event)
CREATE TABLE vault_holdings (
  basket TEXT REFERENCES baskets(pubkey),
  mint TEXT REFERENCES whitelisted_mints(mint),
  raw_amount BIGINT NOT NULL, -- u64
  multiplier NUMERIC NOT NULL DEFAULT 1,
  scaled_amount NUMERIC NOT NULL, -- raw*multiplier
  decimals INT NOT NULL,
  PRIMARY KEY (basket, mint)
);

-- NAV snapshots (every 1 min, keep 1h granular, then 1h rollup)
CREATE TABLE nav_snapshots (
  id BIGSERIAL PRIMARY KEY,
  basket TEXT REFERENCES baskets(pubkey),
  ts TIMESTAMPTZ NOT NULL,
  nav NUMERIC NOT NULL, -- Σ scaled*price (USD)
  supply BIGINT NOT NULL,
  share_price NUMERIC NOT NULL, -- nav/supply
  price_source TEXT NOT NULL -- json of prices used
);
CREATE INDEX ON nav_snapshots(basket, ts DESC);

-- share supply history (for dilution tracking)
CREATE TABLE supply_snapshots (
  basket TEXT REFERENCES baskets(pubkey),
  ts TIMESTAMPTZ NOT NULL,
  supply BIGINT NOT NULL,
  PRIMARY KEY (basket, ts)
);

-- events indexed
CREATE TABLE events (
  sig TEXT PRIMARY KEY,
  slot BIGINT NOT NULL,
  basket TEXT REFERENCES baskets(pubkey),
  type TEXT NOT NULL CHECK (type IN ('BasketCreated','Minted','Redeemed','FeeAccrued')),
  data JSONB NOT NULL,
  ts TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON events(basket, ts DESC);

-- rankings materialized view (refreshed every 5m)
CREATE MATERIALIZED VIEW basket_rankings AS
SELECT
  b.pubkey,
  h.nav,
  h.supply,
  h.nav / NULLIF(h.supply,0) AS share_price,
  -- returns
  (h.nav - first_day.nav) / NULLIF(first_day.nav,0) AS return_30d,
  COUNT(DISTINCT e.sig) FILTER (WHERE e.type='Minted') AS mint_count,
  -- drift: compare current weights vs target
  -- holders: distinct user share ATAs (tracked separately)
FROM baskets b
JOIN LATERAL (SELECT * FROM nav_snapshots WHERE basket=b.pubkey ORDER BY ts DESC LIMIT 1) h ON true
LEFT JOIN LATERAL (SELECT nav FROM nav_snapshots WHERE basket=b.pubkey AND ts > NOW()-'30 days'::interval ORDER BY ts ASC LIMIT 1) first_day ON true
LEFT JOIN events e ON e.basket=b.pubkey
GROUP BY b.pubkey, h.nav, h.supply, first_day.nav;

-- creator stats
CREATE TABLE creator_stats (
  creator TEXT PRIMARY KEY,
  basket_count INT NOT NULL,
  total_aum NUMERIC NOT NULL,
  total_fees_earned NUMERIC NOT NULL
);

-- users (optional, for portfolio)
CREATE TABLE user_positions (
  user TEXT NOT NULL,
  basket TEXT REFERENCES baskets(pubkey),
  share_balance BIGINT NOT NULL,
  cost_basis NUMERIC,
  PRIMARY KEY (user, basket)
);
```

Redis:
- `nav:{basket}` → latest NAV cache (TTL 15s)
- `quote:zap-in:{basket}:{amount}` → Jupiter quote legs cache (30s)
- `rankings` → cached sorted sets for explore pages

Queue (BullMQ):
- `holdings_sync` (every 30s per active basket)
- `nav_snapshot` (every 60s)
- `price_fetch` (every 30s, Jupiter Price API v6)
- `fee_accrue_crank` (every 1h, calls `accrue_management_fee` for baskets with elapsed>1h)

---

## 8. API Routes (tRPC or REST)

Base: `/api/v1`

| Method | Path | Description | Source |
|--------|------|-------------|--------|
| GET | `/baskets` | List baskets with filters: `sort=AUM\|return_24h\|return_7d\|holders`, `creator`, `minAUM`, `search` | rankings view |
| GET | `/baskets/:pubkey` | Basket detail (constituents, weights, fees, NAV, share price, supply, drift, creator, metadata) | baskets + holdings + nav latest |
| GET | `/baskets/:pubkey/holdings` | Raw + scaled holdings per constituent (raw, multiplier, scaled, decimals) | vault_holdings |
| GET | `/baskets/:pubkey/nav/history?interval=1h&from=&to=` | NAV timeseries | nav_snapshots |
| GET | `/baskets/:pubkey/performance` | Returns: `inception, 24h,7d,30d,90d` | computed from snapshots |
| GET | `/baskets/:pubkey/holders` | Holders + balances | user_positions join |
| GET | `/creators/:creatorPubkey` | Creator profile: baskets, AUM, fees earned, rank | creator_stats |
| GET | `/users/:userPubkey/portfolio` | User portfolio: positions + scaled value per basket | user_positions + nav |
| GET | `/whitelist` | Allowed mints: `mint, decimals, status, multiplier, price_source` | whitelisted_mints |
| POST | `/quotes/zap-in` body `{basket, amountUSDC, slippageBps}` | Returns `legs: [{inputMint, outputMint, amount}], expectedAmounts[], txBase64?` (Jupiter) | Jupiter Swap API `quote` + `swap` |
| POST | `/quotes/zap-out` body `{basket, shares, targetMint: USDC, slippage}` | Returns legs to unwind | Jupiter |
| GET | `/prices?mints=...` | Price map for NAV debugging (proxied Jupiter Price API) | cache |
| GET | `/events?basket=&type=&limit=` | Recent events | events table |
| GET | `/health` | Indexer lag, last slot, holdings staleness | internal |

Auth: none for reads; no private routes in V0 (backend never signs). `LEGAL_REVIEW_REQUIRED`: rate limit quotes, disclaim slippage not guaranteed.

Websocket (optional): `ws:/prices/:basket` push NAV updates.

Error shape: `{error: {code, message}, data?}`; code `WEIGHT_MISMATCH`, `PAUSED_MINT`, `INSUFFICIENT_BALANCE` maps to Anchor errors.

---

## 9. Frontend Page Map (Next.js App Router)

```
app/
  layout.tsx              // WalletProvider (Phantom/Solflare), Tailwind, brand, legal footer
  page.tsx                // Landing: hero "Create an index. Own your thesis." + featured baskets + CTA (Explore / Create)
  explore/
    page.tsx              // Grid + filters (AUM, 24h, creator), rankings from /baskets, card shows NAV/AUM/return drift
    loading.tsx
  basket/
    [pubkey]/
      page.tsx            // Detail: NAV, share price, AUM, constituents table (weight vs actual drift), fee schedule, creator, history chart (Recharts), redemption explainer, Buy/Redeem CTA, holders list
      buy/
        page.tsx          // Mint flows: tabs [In-Kind | Zap USDC] → amount inputs + weight preview + fee quote → tx builder (mint_in_kind)
      redeem/
        page.tsx          // Redeem: shares input → proportional out preview (raw + scaled + USD) + exit fee + warning "irreversible, oracle-free"
  create/
    page.tsx              // Wizard (6 steps, Stepper):
                          // 1 Select xStocks (whitelist fetch, 2-20) → 2 Set weights (slider, sum 10k, preset Equal/MarketCap) → 3 Set fees (caps shown, 90/10 split explainer) → 4 Preview seed deposit (calc seed amounts from weights + $1000 example) → 5 Risk/Legal (checkboxes: not ETF, jurisdiction, xStocks instrument, creator not adviser) → 6 Deploy (tx: create_basket atomic seed, metadata upload to IPFS first)
  creator/
    [pubkey]/
      page.tsx            // Creator profile: baskets, total AUM, fees earned (on-chain + indexer), rank, follow
  portfolio/
    page.tsx              // User portfolio: connected wallet → positions table (shares, scaled value, cost basis, drift vs target) + redeem shortcuts, requires wallet
  legal/
    page.tsx              // Disclosure modal + page: not investment advice, jurisdiction restrictions, xStocks structured instruments, risks,  `LEGAL_REVIEW_REQUIRED`
  api/                    // proxy to backend (or direct backend URL via env)
components/
  BasketCard, ConstituentRow (shows scaled amount, multiplier badge), FeeBadge, DriftBar, NavChart, WeightSlider, ZapQuotePanel, LegalModal
hooks/
  useBasket, useHoldings, useNavHistory, useZapQuote, useWhitelist, usePortfolio
lib/
  token2022.ts (multiplier reader), math.ts (mint/redeem/fee), jupiter.ts, solana.ts (connection, PDA)
brand.md                  // written by brand-design skill
```

**Wizard validations (frontend mirrors on-chain):**
- Steps 1-2 block `Next` until `2≤len≤20`, weights sum 10_000, each mint whitelisted Active.
- Step 3 caps: entry 0-300, exit 0-100, mgmt 0-300.
- Step 4 preview: given example $1000 USDC, backend `/quotes/zap-in` preview seed amounts; but `create_basket` still requires in-kind seed raw amounts — zap preview is UX only.
- Step 5 legal checkboxes required; `Deploy` disabled until checked `LEGAL_REVIEW_REQUIRED`.
- Detail page drift = `actual_weight = scaled_i / Σ scaled *10000` vs `target_weights_bps` progress bar.

---

## 10. Test Plan

### 10.1 Unit Tests (Rust, `cargo test` + Anchor `#[program]`)

| Test file | Cases |
|-----------|-------|
| `tests/test_math.rs` | `gross_shares` min across constituents, 1% tolerance revert, floor rounding, `initial_shares=1M` genesis, division by zero guard |
| `tests/test_fees.rs` | entry/exit split 90/10, treasury remainder, mgmt elapsed fee formula, cap never exceeded, hourly vs yearly equivalence |
| `tests/test_validations.rs` | weights sum 10k failure, duplicate mints, fee over cap, 2-20 bounds, metadata_hash zero revert, empty seed revert |
| `tests/test_pda.rs` | seed derivations, bump mismatch, vault authority mismatch, wrong mint authority rejected |
| `tests/test_token2022.rs` | mock mints with `ScaledUiAmountConfig` multiplier 1→2, update does not affect raw transfer; decimals mismatch rejected; malicious token account (wrong owner/mint) rejected |

### 10.2 Integration Tests (LiteSVM / BanksClient)

```ts
// scaffold uses Anchor TS + LiteSVM
describe("foliox basket", () => {
  it("create_basket atomically seeds and validates", ...)
  it("mint_in_kind perfect weights → net shares", ...)
  it("mint_in_kind off-weights reverts WeightMismatch", ...)
  it("redeem_in_kind pro-rata floor, fee split", ...)
  it("full redeem empties vault, second redeem fails", ...)
  it("management fee accrual dilutes over 30d", ...)
  it("pause whitelist blocks mint but not redeem", ...)
  it("cannot withdraw as admin, redeem always permissionless", ...)
  it("malicious token account substitution fails", ...)
  it("inflation attack: first depositor cannot exploit with 1 lamport", ...)
})
```

**Localnet script** `scripts/e2e.sh`: `solana-test-validator` + `anchor deploy` + `node scripts/createWhitelist.ts` + `node scripts/createBasket.ts` + `node scripts/mintAndRedeem.ts` + `node scripts/accrueFee.ts`.

### 10.3 Fuzz / Property Tests (proptest / `anchor + mollusk`)

| Property | Oracle | Shrink |
|----------|--------|--------|
| deposits→full redemption returns expected pro-rata minus fees | `sum(out_i) ≤ sum(in_i)` with equality when no fees drift, within rounding ±N | random 2-5 users, random amounts, random fees within caps |
| no user can redeem more than proportional share | `amount_out_i ≤ vault_raw_i * shares_burn / S_before +1` (floor) | random burn amounts |
| vault consistency after multi-user mints/redeems | `Σ vault_raw_j` monotonic with mints/redeems, total supply accounting `S_new = S_old + net - burn + mgmt` | sequence of 10 random ops |
| management fee never exceeds cap | `fee/S ≤ mgmt_bps * elapsed / (10k * year)` | random elapsed 1s..1y |
| scaled multiplier change does not break raw math | deploy with multiplier 1, update to 0.5→2.0, redeem same raw | random multiplier updates |
| rounding never over-withdraws | `Σ out_i * S_before ≤ V_j * burn_amount + N*1` | edge decimals |

**Invariant helpers:** Use `mollusk` to swap in fake Token-2022 program that exposes multiplier mutation.

### 10.4 Frontend Tests (Vitest + Playwright)

- Wizard steppers, weight sum validation, fee cap UI, legal checkbox gating.
- Buy/Redeem preview matches on-chain math (share calc mocked).
- Drift bar renders correct bps.

### 10.5 Backend Tests (Jest + Supertest)

- `holdings_sync` with mocked RPC (Helius DAS) and multiplier fetch.
- `nav_snapshot` with mocked price feed, asserts `nav = Σ scaled*price`.
- `rankings` sort correctness.

---

## 11. Security Checklist (V0 Gate)

- [ ] **P0: Missing signer** — `creator` in `create_basket`, `user` in `mint/redeem`, `authority` in whitelist all `Signer`. Scan `grep -rn 'AccountInfo' programs/`.
- [ ] **P0: Owner checks** — vault ATAs owned by Token-2022 program, mint owned by Token-2022, no `UncheckedAccount` without `owner == TOKEN_2022_ID`.
- [ ] **P0: No admin withdraw** — verify no instruction can `transfer` vault tokens without corresponding `burn`/`mint` pro-rata logic. Grep `transfer` in basket program allows only `mint_in_kind` (in) and `redeem_in_kind` (out).
- [ ] **P0: Redeem not pausable** — `redeem_in_kind` entry has no `require!(whitelist.status==Active)`; only `mint_in_kind` checks. Add negative test: pause → redeem still succeeds.
- [ ] **P0: Oracle-free redeem** — no `price_feed`, `oracle`, `pyth` account in `redeem` context.
- [ ] **P1: Pro-rata math** — `amount_out = V * burn / S` floor, not `ceil`; fuzz proves no over-withdraw. Reviewed in `review-and-iterate` skill + `security-checklist.md:rounding`.
- [ ] **P1: Initial inflation attack** — genesis `1M` shares fixed, not attacker-controlled `amount/ supply` ratio; test: attacker deposits 1 lamport then victim deposits 1e9 → attacker cannot drain.
- [ ] **P1: Rounding exploit** — dust amounts accumulate in vault (favors remaining holders); document dust not claimable individually.
- [ ] **P1: Decimal/mint mismatch** — `transfer_checked` with `decimals` from whitelist; `WhitelistedMint.decimals` cached, mismatch reverts.
- [ ] **P1: Scaled/raw confusion** — programs never multiply by multiplier; indexer only. Add comment `// RAW ONLY` on all transfers.
- [ ] **P1: Account substitution** — user ATAs verified `owner==user`, `mint==expected`; vault ATAs derived via `associated_token::get_associated_token_address(basket_pda, mint)` and `mut` check.
- [ ] **P1: PDA authority** — `basket PDA` seeds validated in each ix via `#[account(seeds=[...], bump)]`; `share_mint.mint_authority == basket PDA`.
- [ ] **P1: Fee overcharging** — `≤ cap` checks + property test hourly vs yearly; `treasury+creator == fee_shares` no dust loss beyond 1 lamport.
- [ ] **P2: Zap slippage** — V0 sequential swaps: document user may receive different amounts than quoted; next leg reverts if slippage exceeded `slippageBps` threshold. On-chain atomic zap deferred.
- [ ] **P2: Reentrancy/CPI** — no cross-program invocation that re-enters basket (CPI only to Token-2022 + System + ATA); use `#[account(mut)]` checks.
- [ ] **P2: Seed hijack** — `create_basket` seed transfer atomic with basket creation in same tx; no separate `init` then `seed` two-step.
- [ ] Run `cargo audit`, `anchor audit` (if available), `npm audit`, SAST via `cso` skill (secrets, deps, CI).

Deploy gate: `review-and-iterate` + `cso` skills must pass before `deploy-to-mainnet`.

---

## 12. Regulatory / Product-Risk Checklist

> **All items `LEGAL_REVIEW_REQUIRED` — not legal advice, placeholders for counsel.**

| Area | V0 Implementation | Risk note |
|------|-------------------|-----------|
| **Language** | Use only: `strategy basket`, `index basket`, `onchain equity basket`, `xStocks-backed strategy token`. Never `ETF`, `fund`, `guaranteed`, `safe`. Hero: “Create an index. Own your thesis.” | Avoid securities-law implication `LEGAL_REVIEW_REQUIRED` |
| **Not investment advice** | Footer + legal modal + create wizard step 5: “Not investment advice; creators are not licensed advisers; do your own research.” `brand.md` tone check. | Placeholder copy, counsel must approve |
| **Jurisdiction** | Geo-block list in frontend (IP + wallet disclaimer), backend `LEGAL_REVIEW_REQUIRED` to define restricted jurisdictions for xStocks (US, etc.). No on-chain geo gate (can't gate redeem). | Off-chain only, do not make redeem permissioned |
| **xStocks structured instrument** | Detail page + redeem explainer: “xStocks are structured instruments issued by Backed, not direct equity ownership; redemption is on-chain in-kind to xStock tokens, not to underlying shares off-chain.” | Must match issuer disclosure `LEGAL_REVIEW_REQUIRED` |
| **Creator liability** | Creator profile shows disclaimer: “Creator is not a licensed adviser unless verified; past performance not indicative.” Fees disclosed pre-mint. | Split 90/10 may be seen as compensation `LEGAL_REVIEW_REQUIRED` |
| **Fees disclosure** | Wizard preview net shares after fees, detail page fee schedule, portfolio cost basis includes fees. | Required for consumer protection |
| **Custody** | Indexer never custodies, no admin withdraw, docs state “self-custodial, permissionless redeem”. | Central claim must hold under TVL growth |
| **Risk copy** | Portfolio + redeem modal: “Basket value tracks xStock prices, which may depeg; smart contract risk; Token-2022 multiplier changes; Jupiter slippage 1-3% typical; no leverage, no rebalancing in V0 so drift is expected.” | Drift must be visualized (see §9 drift bar) |
| **Metadata immutability** | `metadata_hash` immutable, explains basket cannot pivot thesis post-deploy. | Reduces rug via weight change, but seed still defines initial holdings — document |
| **No yield promises** | Never show APY as guaranteed; performance is historical NAV, not projected. | Marketing video must not imply yield |
| **KYC/POH optional** | `verify-humanity-poh` skill available for airdrops but not gated on basket mint in V0 (permissionless). If later gated, mark `LEGAL_REVIEW_REQUIRED`. | Sybil vs compliance tradeoff |
| **Upgrade authority** | Programs deployed as `upgradable` with multisig upgrade authority `LEGAL_REVIEW_REQUIRED` — disclose upgrade risk, timelock in V1. | V0 multisig should be documented in docs |

Copy placeholders to be replaced after counsel review — do not ship to mainnet with generic legal text.

---

## 13. 90-Day Milestone Plan

| Phase | Days | Deliverable | Owner(s) | Exit Criteria |
|-------|------|-------------|----------|---------------|
| **P0 Spec** | 1–3 | This doc approved, architecture diagram signed off | architect + security reviewer | All §1–12 reviewed, `LEGAL_REVIEW_REQUIRED` items triaged |
| **P1 Scaffold** | 4–8 | `anchor init foliox` with 3 programs (`whitelist`, `basket_factory`, `basket`), `Anchor.toml`, `Cargo.toml`, `lib.rs` shells, PDA constants, error enums, events, minimal CI (`cargo test`, `anchor build`) | Anchor lead | `anchor build` passes, PDAs tested on localnet |
| **P2 Whitelist** | 9–14 | `whitelist` program + TS scripts `scripts/initWhitelist.ts`, `addMint.ts` with Helius fixture mints (mock xStocks Token-2022), unit tests for pause not blocking redeem | Anchor | Unit + LiteSVM pause test green |
| **P3 Factory Create** | 15–22 | `basket_factory::create_basket` with full validation (weights, caps, whitelist, atomic seed), vault ATAs, share mint, genesis shares; script `createBasket.ts` | Anchor | E2E `create_basket` on localnet with 3 xStocks, weights sum 10k, seed atomic verified |
| **P4 Core Mint/Redeem** | 23–36 | `basket::mint_in_kind`, `redeem_in_kind`, `accrue_management_fee` with raw math & fee split, no oracle/pauser | Anchor | Fuzz properties 1-3 green, full redeem empty vault test green |
| **P5 Fees & Multiplier Tests** | 37–42 | Fee math exhaustive + Token-2022 multiplier mock tests (1→2x, 0.95x), rounding, inflation-attack test | Security | All §10.1–10.3 green, `review-and-iterate` first pass |
| **P6 Indexer V0** | 43–55 | Backend: `listener` (Helius DAS + `logsSubscribe`), `holdings_sync`, `nav snapshots`, `price_fetch` (Jupiter), Postgres schema §7, Redis/BullMQ | Backend | Local validator → DB shows baskets, holdings raw/scaled correct, NAV chart populated |
| **P7 Backend API** | 56–62 | REST `/baskets`, `/holdings`, `/nav/history`, `/quotes/zap-in|out` (Jupiter proxy), `ws` price push | Backend | Frontend can fetch explore list + detail from local backend |
| **P8 Frontend Create/Mint/Redeem** | 63–75 | Next.js app `create` wizard (6 steps), `basket/[pubkey]/buy` (in-kind + zap sequential), `redeem`, `portfolio`; `Token-2022` multiplier display, drift bar, legal modal `LEGAL_REVIEW_REQUIRED` | Frontend | Playwright wizard → on-chain `create_basket` e2e on localnet, redeem shows scaled preview correctly |
| **P9 E2E Localnet** | 76–82 | `scripts/e2e.sh`: validator → whitelist → 2 baskets → 3 users mint → redeem → fee crank → NAV snapshots → API → UI smoke | All | `npm run e2e` passes deterministically |
| **P10 Security & Legal Review** | 83–88 | `cso` + `review-and-iterate` + external quick review (if budget), legal copy final `LEGAL_REVIEW_REQUIRED`, `deploy-runbook.md` + `rpc-wallet-guide.md` checklist, devnet deploy | Security + Legal | P0/P1 checklist §11 all checked, threat model STRIDE, audit report filed |
| **P11 Devnet → Mainnet Prep** | 89–90 | Deploy to devnet, seed with real xStocks on devnet (or mock), explorer verified, creator dashboard, ranking landed; mainnet deploy plan (multisig, timelock, upgrade authority disclosed) | All | Devnet demo link live, `deploy-to-mainnet` skill checklist passed, go/no-go for mainnet-beta |

Post-90: mainnet-beta with capped TVL, bug bounty, formal verification via QEDGen for math invariants if flagged by `review-and-iterate`.

---

## Appendix A: Open Questions (Resolved or Assumption)

| # | Question | Decision (V0) |
|---|----------|----------------|
| 1 | Share mint decimals? | 6 (like USDC), fixed |
| 2 | Genesis shares fixed vs proportional? | Fixed 1_000_000 to prevent inflation attack |
| 3 | Mint weight tolerance? | Revert if >1% deviation (strict). V1 could auto-normalize. |
| 4 | Whitelist governance? | Single multisig `authority`, upgradable programs, no DAO yet |
| 5 | Zap atomicity? | Client sequential swaps → `mint_in_kind`; document tradeoff, V1 on-chain router via Jupiter CPI |
| 6 | Price source for NAV? | Jupiter Price API v6 (cached, not on-chain) |
| 7 | Upgradeability? | Upgradable with disclosed multisig authority (not immutable) `LEGAL_REVIEW_REQUIRED` |

## Appendix B: References

- `~/.agents/skills/data/solana-knowledge/03-contract-level.md` (PDAs, Anchor)
- `~/.agents/skills/data/guides/security-checklist.md` (P0/P1 audit)
- `foliox_build_prompt.md` (thesis, constraints, required outputs)
- Backed xStocks Token-2022 docs (Scaled UI Amount extension)
- Jupiter Price/Swap APIs

---

## Implementation Status Amendment — 2026-09-01

This specification remains the normative product and security contract. The repository has since been scaffolded, but the current implementation is not localnet-ready: protocol transfer/mint/burn paths, backend/indexer wiring, wallet flows, and strict frontend typing still have known gaps. The execution order and verified findings are recorded in `plan.md` and `docs/ui-discovery-2026-09-01.md`.

Do not interpret the passing unit-test counts as proof of end-to-end protocol correctness. Before devnet/mainnet work, complete the real-account localnet flow and the P0/P1 security checklist in this document.

### Amendment 2 — 2026-09-01 (implementation waves complete)

The gaps listed above have been closed in an orchestrated implementation wave (details and evidence in `plan.md` §6-§8):

- §3 instructions are fully implemented with real Token-2022 CPIs (`transfer_checked`/`burn`/`mint_to`, RAW only). `mint_in_kind` carries the whitelist pause gate via a **4n remaining-accounts contract** (3n `[mint, user_ata, vault_ata]` triplets + n `WhitelistedMint` PDAs, fail-closed `MintPaused`); `redeem_in_kind` remains 3n and structurally tested as gate-free. Factory performs atomic seed transfers and mints genesis 1M via a temporary mint authority handed to the basket vault-authority PDA within the same transaction.
- §4 multiplier reads: the installed `spl-token` 0.4.15 encodes `ScaledUiAmountConfig.multiplier` as **f64** (not the u64 fixed-point sketch in §4.3); the indexer reads f64 with fallback 1.0.
- §7-8 backend: normative schema live-applied, event decoding, holdings sync, exact BigInt fixed-point NAV, and all §8 routes serve real indexed data with `source`/`asOf` markers; empty/unavailable states are explicit, never fabricated. The backend builds unsigned fee-crank transactions only — it never signs (§2 constraint 5).
- Tests at amendment time: 178 Rust + 373 backend TS (+1 root legacy). CPI execution paths remain unverified on a live validator until the SBF toolchain blocker (edition2024 platform-tools) is resolved — see `plan.md` §8 localnet E2E status. This supersedes none of the normative constraints; §11 P0/P1 evidence is recorded in the `plan.md` §6 gate table.

### Amendment 3 — 2026-09-11 (V0.2 Social Trading Layer)

Adds a social trading surface (fomo.family-inspired, deliberately not a clone) on top of the existing on-chain-verified data. Branch `feat/social-trading`. Normative additions:

**Principle.** Every basket trade already settles on-chain, so the social feed shows *verified activity, not claims* — exactly the property that makes fomo's feed trustworthy. The "what" (trades) comes from the indexer's per-wallet `events` ledger; the "why" is user-authored **thesis posts** linked to a basket. No auto-copy: copying = "Clone this basket" prefilled into the create wizard (auto-copy is both the regulatory flashpoint — ESMA/MiCA/ASIC treat it as a potential investment service — and latency-broken in practice).

**New backend surface** (normative shapes in `backend/src/api/social.ts`, route map in `backend/src/api/routes.ts`):

- Tables: `profiles`, `follows`, `posts(kind='thesis')`, `post_likes`, `comments`, `user_value_snapshots`, expression index `events((data->>'user'), ts DESC)` — all idempotent additions to `schema.sql`.
- Auth: SIWS-lite (`POST /auth/nonce` → wallet signs exact message `FolioX Social\nWallet: <wallet>\nNonce: <nonce>` → `/auth/verify` verifies ed25519 → HMAC bearer token, 7d, secret `SOCIAL_AUTH_SECRET`). **Auth gates social writes only**; §2 constraint 5 (backend never signs) is unaffected.
- Reads: `/users/:wallet/profile|history|equity-curve|followers|following`, `/feed?scope&type`, `/leaderboard?window`. Writes: `PUT /me/profile`, follow/unfollow, thesis posts, likes, comments.
- Privacy: `profiles.is_public=false` excludes a wallet from feed + leaderboard (default is public — the on-chain ledger is public regardless; the toggle governs platform discovery surfaces only).
- Leaderboard honesty: ROI is *estimated* (cost basis derives from NAV reference pricing, not fill prices) and anti-sybil gated (≥2 mints, first trade ≥7d, live value > 0). 7d/30d windows require `user_value_snapshots` history (worker `workers/userSnapshot.ts`, ~5m) — empty until accumulated, never backfilled with synthetic data.

**Frontend:** `/feed`, `/leaderboard`, social profile on `/creator/[pubkey]` (equity curve, history, follow, edit/privacy), thesis composer (basket page + post-trade CTA), clone prefill `/create?clone=<pubkey>`. 30s polling; no realtime infrastructure added in V0.2.

**Deliberately out of scope (V0.2):** auto-copy execution, push notifications, websockets, per-trade PnL realization accounting, EVM.
