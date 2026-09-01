# Master Build Prompt — FolioX / xStocks Strategy Baskets

You are a senior Solana protocol architect, Anchor engineer, DeFi security reviewer, and product-minded full-stack lead. Design and implement an original Solana-first protocol inspired by the public mechanics of HoodETF, but do not copy HoodETF code, UI, branding, names, text, or legal claims.

## Product thesis

Build **FolioX**, a Solana dApp where anyone can create an investable, tokenized strategy basket using **xStocks** as the underlying assets. A creator selects 2–20 xStocks, defines fixed weights, sets capped fees, seeds the basket, and deploys a vault. The vault holds the real xStocks on-chain and mints a new basket share token. Investors can buy the basket with USDC, hold one basket token, redeem in-kind for the proportional underlying xStocks, or zap out to USDC.

Do not describe this as a registered ETF. Use language like **strategy basket**, **index basket**, **onchain equity basket**, or **xStocks-backed strategy token**.

## Non-negotiable V0 constraints

1. Baskets are immutable after deployment: constituents, target weights, fee schedule, creator, and basket metadata hash cannot change.
2. No leverage, lending, derivatives, rebasing basket token, active discretionary rebalancing, or pooled off-chain custody.
3. Every basket share must represent pro-rata ownership of the real xStocks held in the vault.
4. In-kind redemption must be permissionless, oracle-free, and never pausable.
5. The backend/indexer must never custody funds or hold keys able to move user assets.
6. All xStocks accounting on Solana must be **Token-2022 / Scaled UI Amount aware**.
7. Transactions must use raw Token-2022 amounts. Display, NAV, and weights must use `scaledAmount = rawAmount × multiplier`.
8. Jupiter zap-in/zap-out is useful UX, but it must be a periphery path. The core protocol must still support in-kind mint/redeem.
9. Add legal/risk copy as product placeholders: not investment advice, jurisdiction restrictions, xStocks are structured instruments, creators are not licensed advisers unless proven otherwise.

## Reference model to emulate conceptually

Use this pattern:

- BasketFactory deploys basket vaults.
- Basket vault holds whitelisted underlying tokens.
- Basket vault mints one basket share token.
- Buying mints shares.
- Redeeming burns shares and returns proportional underlying.
- Zap router converts one stablecoin into the required basket components and mints shares in one flow.
- Fees are capped and split between creator and protocol treasury.
- Indexer computes NAV, AUM, historical performance, rankings, and creator dashboards.

## Target stack

### Solana protocol

Use Anchor unless there is a strong reason not to.

Programs/modules:

1. `basket_factory`
   - Creates new basket vault accounts.
   - Validates constituents are whitelisted xStocks.
   - Validates 2–20 constituents.
   - Validates weights sum to 10,000 bps.
   - Validates fee caps.
   - Creates basket share mint.
   - Records creator, treasury, fee schedule, constituent mint list, weight bps, metadata hash, creation timestamp.
   - Requires creator seed deposit atomically so a basket cannot be created empty or hijacked.

2. `basket`
   - Holds underlying xStocks in token accounts owned by the basket PDA.
   - Supports `mint_in_kind`.
   - Supports `redeem_in_kind`.
   - Supports `accrue_management_fee`.
   - Supports entry, exit, and management fee share accounting.
   - Must not include any admin withdraw function for user assets.
   - Must not gate redeem on oracle, backend, price feed, or keeper.

3. `whitelist`
   - Stores allowed xStock mints.
   - Stores decimals, Token-2022 metadata assumptions, optional price source identifier, and status.
   - Governance may pause new minting for a problematic constituent, but may not pause in-kind redemption.

4. Optional `zap_router` periphery
   - Integrates Jupiter quote/transaction flow off-chain first.
   - On-chain router should not become a custody layer.
   - V0 can implement zap as client-side sequential Jupiter swaps followed by in-kind mint, but document the atomicity tradeoff.

### Token handling

Support SPL Token-2022. For each xStock:

- Store raw balances on-chain.
- For UI/NAV, read the Scaled UI Amount multiplier.
- Use raw amounts for transfers.
- Compute user-facing balance as raw × multiplier.
- Test dividend/split multiplier updates explicitly.

### Fee model

Use configurable caps:

- Entry fee cap: 300 bps.
- Exit fee cap: 100 bps.
- Management fee cap: 300 bps/year.
- Default split: 90% creator / 10% protocol treasury, but make this configurable at protocol level.

Fees should be paid in basket shares:

- Entry fee: minted/withheld as shares from gross shares.
- Exit fee: portion of redeemed shares transferred to creator/treasury instead of burned.
- Management fee: streamed via dilution using elapsed time.

### Backend/indexer

Use TypeScript, Node.js, PostgreSQL, Redis, and a job queue.

Responsibilities:

- Index BasketCreated, Minted, Redeemed, FeeAccrued events.
- Track basket holdings by reading on-chain token accounts.
- Read xStock multipliers and compute scaled balances.
- Compute NAV = Σ(scaled_amount × price).
- Compute share price = NAV / basket_share_supply.
- Store NAV snapshots.
- Rank baskets by AUM, 24h/7d/30d/inception return, flows, holders, creator, and risk metrics.
- Build zap-in and zap-out quote payloads using Jupiter APIs.
- Serve REST or tRPC API to frontend.

Backend must be convenience only. If backend fails, users must still be able to redeem in-kind through the program.

### Frontend

Use Next.js, TypeScript, Tailwind, and a Solana wallet adapter.

Core pages:

1. Landing page
2. Explore baskets
3. Basket detail page
4. Buy / mint flow
5. Redeem flow
6. Create basket wizard
7. Creator profile
8. User portfolio
9. Risk/legal disclosure modal

Create wizard steps:

1. Select xStocks.
2. Set weights.
3. Set fees.
4. Preview required seed deposit.
5. Review risk/legal copy.
6. Deploy.

Basket detail page should show:

- NAV
- Share price
- AUM
- Constituents and weights
- Current drift from target weights
- Creator
- Fee schedule
- Historical return
- Underlying redemption explanation
- Buy and redeem buttons

## Required outputs before writing code

First produce:

1. System architecture diagram in text form.
2. Solana account model.
3. Instruction list with arguments and validations.
4. Token-2022/multiplier accounting plan.
5. Mint/redeem math with examples.
6. Fee math with examples.
7. Backend data model.
8. API routes.
9. Frontend page map.
10. Test plan.
11. Security checklist.
12. Regulatory/product-risk checklist.
13. 90-day milestone plan.

After the plan is approved, generate code incrementally in this order:

1. Anchor workspace scaffold.
2. Account structs and constants.
3. Whitelist program.
4. BasketFactory create flow.
5. Basket mint_in_kind.
6. Basket redeem_in_kind.
7. Fee accounting.
8. Unit tests for all math.
9. Token-2022 mocked multiplier tests.
10. Indexer schema.
11. Backend event listener.
12. NAV worker.
13. Frontend create/buy/redeem flows.
14. End-to-end localnet script.

## Security requirements

Check for:

- Incorrect pro-rata redemption math.
- Rounding exploits.
- Initial share inflation attacks.
- Fee overcharging.
- Management fee compounding errors.
- Token decimal mismatch.
- Token-2022 raw/scaled amount confusion.
- Malicious token accounts.
- Wrong vault authority PDA.
- Unauthorized mint authority.
- Pausing redemption by accident.
- Oracle dependency in withdrawal path.
- Zap slippage and partial-fill risk.
- Reentrancy-equivalent CPI risks.
- Account substitution attacks.

Include fuzz/property tests for:

- deposits followed by full redemption returns expected pro-rata assets minus fees.
- no user can redeem more than proportional share.
- total vault value accounting remains consistent after multiple users mint/redeem.
- management fee never exceeds configured cap over elapsed time.
- scaled UI multiplier changes do not break raw transfer math.

## Product tone

Position FolioX as:

- “Create an index. Own your thesis.”
- “Onchain strategy baskets powered by xStocks.”
- “One token for any tokenized equity thesis.”

Avoid:

- “registered ETF”
- “guaranteed return”
- “safe investment”
- “financial advice”
- “we manage your money”

## Final answer format for the agent

Be practical. Do not give generic startup advice. Produce implementation-ready specs. Explicitly flag assumptions. Whenever a design decision has a regulatory implication, mark it as `LEGAL_REVIEW_REQUIRED`.
