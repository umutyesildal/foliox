# Devnet Tokenized-Equity Research — 2026-09-03

**Question:** Do REAL xStocks (Backed Finance) and Ondo (OUSG/USDY) tokens exist on Solana devnet/testnet, and can we use them for a devnet basket test?

**Method:** Official docs (docs.xstocks.fi, docs.ondo.finance) fetched 2026-09-03 + **direct on-chain verification** via `getAccountInfo` (jsonParsed) against `https://api.devnet.solana.com` and `https://api.mainnet-beta.solana.com` on 2026-09-03.

---

## Verdict table

| Provider | Token(s) | Mainnet-beta mint | On devnet? | Official devnet docs? | Devnet-usable for basket test? |
|---|---|---|---|---|---|
| Backed Finance (xStocks) | TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` (Token-2022, dec 8) | **NO** — account not found | **NO** — docs.xstocks.fi has zero devnet/testnet references | No — self-minted mocks required |
| Backed Finance (xStocks) | AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` (Token-2022, dec 8) | **NO** | NO | No |
| Backed Finance (xStocks) | NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` (Token-2022, dec 8) | **NO** | NO | No |
| Backed Finance (xStocks) | SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` (Token-2022, dec 8) | **NO** | NO | No |
| Ondo Finance | OUSG | `i7u4r16TcsJTgq1kAG8opmVZyVnAKBwLKu6ZPMwzxNc` (legacy SPL, dec 6; observed on-chain supply 0) | **NO** | NO — docs.ondo.finance llms.txt index has no testnet/devnet pages | No |
| Ondo Finance | USDY | `A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6` (legacy SPL, dec 6) | **NO** | NO | No |

**Bottom line: nothing official exists on devnet for either issuer. Devnet basket testing must use self-minted mock mints.**

---

## 1. Backed Finance xStocks

### No devnet/testnet deployment (confirmed two ways)

1. **Docs:** docs.xstocks.fi/developers references only production chains (Ethereum, Arbitrum, Mantle, Ink, Solana, TON) with no network qualifiers; the words "devnet"/"testnet"/"faucet" do not appear. Mint addresses are exposed only via their Assets API endpoints (`/apis/openapi/assets`), which serve mainnet addresses.
   - Source: https://docs.xstocks.fi/developers (fetched 2026-09-03)
2. **On-chain:** `getAccountInfo` for all four mints above against `api.devnet.solana.com` returned no mint account (slot ~492,381,36x). Same call against `api.mainnet-beta.solana.com` returned full Token-2022 mint accounts.
   - Sources: `https://api.devnet.solana.com`, `https://api.mainnet-beta.solana.com` (JSON-RPC `getAccountInfo`, 2026-09-03)

### Mainnet mint facts (verified on-chain, mainnet-beta)

All four mints are owned by Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`), **decimals 8**, with exactly the extension suite xStocks are known for:
`metadataPointer, permanentDelegate, defaultAccountState, scaledUiAmountConfig, pausableConfig, confidentialTransferMint, transferHook, tokenMetadata`

This matches the official statement: "Solana xStocks use the Scaled UI Amount Extension, part of the SPL Token-2022 standard" — https://docs.xstocks.fi/developers/multipliers — and the Solana case study (1 real share in custody = 1 SPL token minted): https://solana.com/news/case-study-xstocks

### IMPORTANT correction to docs/providers.md (documented here only; no file edited)

`docs/providers.md` §2 labels these four addresses as "(mock)" — **they are the REAL mainnet xStocks mints**, not mocks (vanity `Xs…` prefixes; live Token-2022 accounts with the full xStocks extension suite and non-trivial supply, e.g. TSLAx supply ≈ 22,963,788 × 10⁸ raw). Also, providers.md lists **decimals 6; actual on-chain decimals are 8**. Any future mainnet work must use decimals 8.

### Non-canonical "TSLAx" tokens (avoid)

Two other Solscan "Tesla xStock" candidates were found and checked on mainnet — both are **legacy SPL Token** (owner `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`), decimals 6, no extensions, i.e. NOT Token-2022 and not canonical xStocks:
- `HHhyHzesTKQxuShvtphgJN1ProZ2dyidfyjeh1VZcPEE`
- `EMxi7Sod1RRffXeAvZwHhm2rvaEDgR4ga5yFgLNrWFPK`

*Assumption:* these are lookalike/copycat listings (program + extension mismatch with the documented xStocks standard). Do not whitelist them.

---

## 2. Ondo Finance (OUSG / USDY)

- Ondo docs' llms.txt index (https://docs.ondo.finance/llms.txt, fetched 2026-09-03) contains **no testnet/devnet pages**; no Solana-specific guide exists, and the addresses page lists only production deployments.
- Official Solana mints from https://docs.ondo.finance/addresses (fetched 2026-09-03):
  - OUSG: `i7u4r16TcsJTgq1kAG8opmVZyVnAKBwLKu6ZPMwzxNc`
  - USDY: `A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6`
  - Also listed for Solana (mainnet): Ondo Stocks program `XzTT4XB8m7sLD2xi6snefSasaswsKCxx5Tifjondogm`, USDon `ZPFtoCe7WWqG4N3ZFRccS8T9SMBeHsd1Vmgv2i7ondo`, OFT bridge adapter `7YNReenG6AXgVUfmSizt6hoVXrznS4zDdgCj1UTLJ2S3`
- **On-chain check (2026-09-03):** neither OUSG nor USDY mint exists on devnet; both exist on mainnet-beta (legacy SPL Token program, decimals 6). Observed nuance: the documented OUSG mint showed on-chain supply 0 — *assumption:* legacy/migrating deployment; unverified whether a newer Token-2022 OUSG mint exists. Not relevant to devnet testing either way.
- Ondo natively deployed OUSG/USDY on Solana mainnet (announcement: https://x.com/Ondo/status/1737224132717166809; product pages https://ondo.finance/ousg, https://ondo.finance/usdy). Ondo issuance is KYC-gated — there is no retail faucet, so even on mainnet we could not freely mint test inventory.

---

## 3. Faucets for tokenized equities on devnet

None found. The only official Solana devnet faucet is SOL-only (https://faucet.solana.com — *standard knowledge, not re-fetched*). No Backed/Ondo test-token program exists; web searches surfaced no community faucet holding xStocks/Ondo devnet tokens (consistent with the on-chain absence above).

---

## 4. Recommendation: mock strategy on devnet (as expected)

1. **Reuse `scripts/createWhitelist.ts` logic against devnet RPC.** The script already: funds the payer via RPC airdrop (`ensureSol`, works on devnet — note devnet airdrop rate limits, ~2 SOL/attempt, retry `10` already implemented), creates Token-2022 mints with `ScaledUiAmountConfig` at multiplier 1.0 (with layout fallbacks), mints a 10 M supply to the payer, and drives `whitelist::init_config` + `add_mint` with `price_source = "mock:<sym>"`. Only the RPC endpoint env needs to point at devnet; no code changes strictly required.
2. **Mirror production more closely (optional, cheap):** use **decimals 8** for mocks to match real xStocks (script currently uses 6 — see correction above), and optionally add the `tokenMetadata` extension so devnet explorers show TSLAx/NVDAx/AAPLx names. Skip `transferHook`/`permanentDelegate`/`pausableConfig` in mocks unless the basket program must exercise them.
3. **Pricing on devnet:** Jupiter Price API (`price.jup.ag`) prices mainnet mints only; on devnet there is no price feed, so keep the whitelist `mock:<sym>` price source — this is already the script's behavior.
4. **Record mainnet mint addresses now** for future mainnet work (they are the `Xs…` table above — currently mislabeled as "mock" in docs/providers.md, with wrong decimals). When mainnet work starts, the same `add_mint` flow registers the real mints; Jupiter prices then become the live source.
5. **Ondo:** treat as mainnet-only reference inventory; no devnet simulation needed for V0.1 (basket uses xStocks mocks). If OUSG/USDY mocks are ever wanted, mint plain Token-2022 mocks the same way.

---

## 5. Assumptions & caveats

- "No official devnet xStocks/Ondo mints exist" rests on (a) official docs containing no devnet/testnet references, (b) the known mainnet mints being absent on devnet, and (c) web search finding none. We cannot enumerate every devnet account, so a differently-addressed unofficial devnet deployment is theoretically possible — but nothing official exists to rely on.
- Mainnet on-chain state (supplies, extensions) captured 2026-09-03 via public RPC; re-verify before mainnet integration.
- Solscan candidates A/B for TSLAx judged non-canonical by program/extension mismatch (assumption, clearly flagged above).
- docs/providers.md was NOT modified (read-only task); the decimals-6→8 and mock→real-mainnet corrections are recorded here only.

## 6. Source index

- https://docs.xstocks.fi/developers — xStocks dev docs: chains, Assets API for addresses; no devnet/testnet
- https://docs.xstocks.fi/developers/multipliers — Scaled UI Amount Extension on Solana xStocks
- https://xstocks.fi/ , https://backed.fi/ — issuer/product pages
- https://solana.com/news/case-study-xstocks — 1 share = 1 SPL token minting model
- https://solana.com/docs/tokens/extensions/scaled-ui-amount — ScaledUiAmountConfig extension
- https://docs.ondo.finance/llms.txt — full docs index; no devnet/testnet pages
- https://docs.ondo.finance/addresses — OUSG/USDY Solana mints (mainnet)
- https://x.com/Ondo/status/1737224132717166809 — Ondo Solana deployment announcement
- https://ondo.finance/ousg , https://ondo.finance/usdy — product pages
- https://solanacompass.com/projects/Ondo — third-party Ondo-on-Solana overview
- On-chain JSON-RPC `getAccountInfo` vs `api.devnet.solana.com` and `api.mainnet-beta.solana.com`, executed 2026-09-03 (authoritative for the verdict table)
- https://faucet.solana.com — SOL-only devnet faucet (standard knowledge)
