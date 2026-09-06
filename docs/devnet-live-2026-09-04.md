# FolioX — Devnet Live Evidence Pack (2026-09-04)

> Canonical evidence sources on disk (read-only, do not regenerate by hand):
> - `scripts/.e2e-devnet/devnet-evidence.json` — all 38 signatures + per-address RPC verification (`generatedAt` 2026-09-04T17:00:53Z)
> - `scripts/.e2e-devnet/logs/*.log` — full stdout of every script step (deploys, whitelist ladder, basket ladder 6→5→4→3, mint/redeem, fee)
> - `backend/.devnet-live-evidence.json` — live API/DB verification against the running backend (`capturedAt` 2026-09-04T17:43:23Z)
>
> Network: Solana **devnet**, RPC `https://api.devnet.solana.com`. Explorer links use `?cluster=devnet`.

## 1. Executive summary — what is live

The full FolioX protocol ran end-to-end on Solana devnet on 2026-09-04 and the state is still live and RPC-verifiable:

- **3 Anchor programs deployed and verified** at their declared IDs (`declaredIdMatches: true` on all three): `whitelist`, `basket_factory`, `basket`.
- **12 mock xStocks** (Token-2022, 6 decimals, `ScaledUiAmountConfig` multiplier 1.0) created and **whitelisted** on-chain (`add_mint` × 12, all `Active(0)`).
- **One live basket** at 3 constituents — NVDAx/AAPLx/MSFTx, weights 4000/3200/2800 bps, fees 100/50/200 bps — with the full lifecycle executed on-chain: **mint_in_kind, redeem_in_kind, accrue_management_fee** all confirmed.
- **`redeem_in_kind` proven permissionless under stress**: a constituent was PAUSED on the whitelist and the redeem still succeeded (pause gates mint only — spec §11 invariant, now proven on a live chain, not just in tests).
- **Supply, fee split, and NAV reconcile exactly** (§4) — down to the last raw base unit.
- **Backend live against devnet**: indexer + NAV engine + fee crank running off the same RPC; 12 `whitelisted_mints` rows, 5 events, 3 user positions, NAV snapshots (§5).
- **38 transactions, all confirmed, all `err: null`** (§3).
- **599 tests green**: 178 Rust (`cargo test`) + 421 backend TS (`npm --prefix backend test -- --run`, includes the new `livewire.test.ts` regressions written from bugs found during this run).
- **Known limit (§6):** `create_basket` with 4+ constituents exceeds the legacy transaction wire limit (1232 bytes) — **not a program error**. The ladder was tested 6→5→4→3; the basket is live at 3. Fix path: versioned (v0) transactions + address lookup tables (deferred — plan.md §7).

## 2. Addresses

### 2.1 Programs (deployed, executable, upgradeable loader)

| Program | Address | Slot | ELF (ProgramData) |
|---|---|---|---|
| `whitelist` | [FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS](https://explorer.solana.com/address/FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS?cluster=devnet) | 493110585 | 261,816 B |
| `basket_factory` | [3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF](https://explorer.solana.com/address/3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF?cluster=devnet) | 493110824 | 537,736 B |
| `basket` | [6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k](https://explorer.solana.com/address/6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k?cluster=devnet) | 493111012 | 593,416 B |

All three: owner `BPFLoaderUpgradeab1e…`, `executable: true`, declared ID in `programs/*/src/lib.rs` matches the on-chain account (cross-program CPI checks compile against the same IDs).

### 2.2 The 12 whitelisted mock xStocks (Token-2022, 6 decimals, ScaledUiAmountConfig ×1.0)

These are **self-minted devnet mocks** — no official devnet xStocks exist (`docs/devnet-tokens-research-2026-09-03.md`). Do not confuse with real mainnet xStocks (8 decimals — `docs/providers.md`).

| Symbol | Mint | Whitelist PDA | Status |
|---|---|---|---|
| TSLAx | [3NwEDKm1bRspo7FPAQd4LxZTmpfbjUx4mWvkrjPP7KFW](https://explorer.solana.com/address/3NwEDKm1bRspo7FPAQd4LxZTmpfbjUx4mWvkrjPP7KFW?cluster=devnet) | [89d1aYGuRjH9zcscQv2ufVxzD4kqoZAa7xqjXKmcYkaT](https://explorer.solana.com/address/89d1aYGuRjH9zcscQv2ufVxzD4kqoZAa7xqjXKmcYkaT?cluster=devnet) | Active(0) |
| NVDAx | [Duagr7hYLnUcG42gu3xqhbSj1E6xwEvRMEN14CG5BKwn](https://explorer.solana.com/address/Duagr7hYLnUcG42gu3xqhbSj1E6xwEvRMEN14CG5BKwn?cluster=devnet) | [84rEpycWsn6HU4VfFg6jWCYH6Efup9GsVKSb89eUxrTX](https://explorer.solana.com/address/84rEpycWsn6HU4VfFg6jWCYH6Efup9GsVKSb89eUxrTX?cluster=devnet) | Active(0) |
| AAPLx | [7T5QwHsqHd5YmMSoJqg69kGsUVF7MMVzmy2bAumgPD23](https://explorer.solana.com/address/7T5QwHsqHd5YmMSoJqg69kGsUVF7MMVzmy2bAumgPD23?cluster=devnet) | [5439x1Sis9in6vwFBreF5a1vMPsEZbfWZ28DEjR2Wj6V](https://explorer.solana.com/address/5439x1Sis9in6vwFBreF5a1vMPsEZbfWZ28DEjR2Wj6V?cluster=devnet) | Active(0) |
| MSFTx | [4gZh5JxhrfKMg7x14evWcrhM3hWHfrtcq6cNgFPH5kQa](https://explorer.solana.com/address/4gZh5JxhrfKMg7x14evWcrhM3hWHfrtcq6cNgFPH5kQa?cluster=devnet) | [5bh9gvWXhrBX6g8NMYcRZvxckhJEde2gK2S9xkrjGQZh](https://explorer.solana.com/address/5bh9gvWXhrBX6g8NMYcRZvxckhJEde2gK2S9xkrjGQZh?cluster=devnet) | Active(0) |
| AMZNx | [6JjHTTUediahYntYLyrrBtbThqcrNRkFMa3MvkBQAM1h](https://explorer.solana.com/address/6JjHTTUediahYntYLyrrBtbThqcrNRkFMa3MvkBQAM1h?cluster=devnet) | [EUD7Hk8tDbXSXMQSqNfrA2NuGuVfJCfkrzeAv39VmQNY](https://explorer.solana.com/address/EUD7Hk8tDbXSXMQSqNfrA2NuGuVfJCfkrzeAv39VmQNY?cluster=devnet) | Active(0) |
| GOOGLx | [cwKxRhYYZyeZSkgLX3JT1KERSTFkzua2RcgaDucSsvj](https://explorer.solana.com/address/cwKxRhYYZyeZSkgLX3JT1KERSTFkzua2RcgaDucSsvj?cluster=devnet) | [6QhheDj7jGZ4gZWHSfVRQdnsyCjduAE1iZxneSeX8as6](https://explorer.solana.com/address/6QhheDj7jGZ4gZWHSfVRQdnsyCjduAE1iZxneSeX8as6?cluster=devnet) | Active(0) |
| METAx | [E4SnZpaaQorTGtZNznYEFNTp3U1a3au9B4cwJBdjvZjG](https://explorer.solana.com/address/E4SnZpaaQorTGtZNznYEFNTp3U1a3au9B4cwJBdjvZjG?cluster=devnet) | [ASgFh4F38VNeNi1RYddb8JgHofxRam1a6Kgt5r9HmXEk](https://explorer.solana.com/address/ASgFh4F38VNeNi1RYddb8JgHofxRam1a6Kgt5r9HmXEk?cluster=devnet) | Active(0) |
| AMDx | [D5B7VowfXWzGoy1fYAbQ4ci9rno1LbHv1YFJsMHqu4yA](https://explorer.solana.com/address/D5B7VowfXWzGoy1fYAbQ4ci9rno1LbHv1YFJsMHqu4yA?cluster=devnet) | [Aw6tz7N7ZDJBZB3txVUPtzXXZK41ZWqCL6DnogpZNcmz](https://explorer.solana.com/address/Aw6tz7N7ZDJBZB3txVUPtzXXZK41ZWqCL6DnogpZNcmz?cluster=devnet) | Active(0) |
| COINx | [Gf9KAJ6XvuYZDvQ8g5uHzZjBYk8fDDsxdyx4uQF4sXWc](https://explorer.solana.com/address/Gf9KAJ6XvuYZDvQ8g5uHzZjBYk8fDDsxdyx4uQF4sXWc?cluster=devnet) | [3KNcf1eYvR2gmTbtALtBLxWnQqAoTM9XVji6wrBVnpMb](https://explorer.solana.com/address/3KNcf1eYvR2gmTbtALtBLxWnQqAoTM9XVji6wrBVnpMb?cluster=devnet) | Active(0) |
| MSTRx | [FHUwgMzYymmgArrXdNksWMTDFcnRxXBCZ75tBMuxPQMG](https://explorer.solana.com/address/FHUwgMzYymmgArrXdNksWMTDFcnRxXBCZ75tBMuxPQMG?cluster=devnet) | [9yd1xRwHD7qWsBdoQteqn9dZQ8asVJNUUhVvLprrudjp](https://explorer.solana.com/address/9yd1xRwHD7qWsBdoQteqn9dZQ8asVJNUUhVvLprrudjp?cluster=devnet) | Active(0) |
| HOODx | [GkozZZUoQLqBaqCq4QSPSErQSnf3rxvtwLppwkMoUD77](https://explorer.solana.com/address/GkozZZUoQLqBaqCq4QSPSErQSnf3rxvtwLppwkMoUD77?cluster=devnet) | [DLyU8k44Cf7jnbGzcqPu9aAPkikHSdJiZGMqr8pyjmZN](https://explorer.solana.com/address/DLyU8k44Cf7jnbGzcqPu9aAPkikHSdJiZGMqr8pyjmZN?cluster=devnet) | Active(0) |
| SPYx | [9o6it8d2QXmKpZbkSXGHPpaQ7P1zFMDd3geTrecVuYon](https://explorer.solana.com/address/9o6it8d2QXmKpZbkSXGHPpaQ7P1zFMDd3geTrecVuYon?cluster=devnet) | [WUCZgxbiPoSHiAs7vbaHDKCgnSzwaYq9wwVfaS5VTod](https://explorer.solana.com/address/WUCZgxbiPoSHiAs7vbaHDKCgnSzwaYq9wwVfaS5VTod?cluster=devnet) | Active(0) |

Whitelist config PDA: [ESRwG8qoKaLM17dLEM6MJDRpKVYtkd9M2zUmbud2uXZd](https://explorer.solana.com/address/ESRwG8qoKaLM17dLEM6MJDRpKVYtkd9M2zUmbud2uXZd?cluster=devnet) — `recordCount: 12`, `allActive: true`.

### 2.3 The live basket

| Role | Address |
|---|---|
| Basket PDA | [9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg](https://explorer.solana.com/address/9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg?cluster=devnet) (data 888 B) |
| Share mint | [7xo7uw13B4DnfwAMGQ9MC5qkX2zD2rUp94j4UBQ61eSE](https://explorer.solana.com/address/7xo7uw13B4DnfwAMGQ9MC5qkX2zD2rUp94j4UBQ61eSE?cluster=devnet) — supply 551,050,751 raw, 6 decimals, mint authority = vault PDA |
| Vault authority PDA | [9Eh9i7Uru8kaZ8zqxY5cpiE11fVDHU8APYSXM7ThLn8b](https://explorer.solana.com/address/9Eh9i7Uru8kaZ8zqxY5cpiE11fVDHU8APYSXM7ThLn8b?cluster=devnet) |
| Creator | [y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE](https://explorer.solana.com/address/y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE?cluster=devnet) — share ATA [856Y5CtmVWjYug1U4igszf55vvqz7BGpBfysMiiLB3kJ](https://explorer.solana.com/address/856Y5CtmVWjYug1U4igszf55vvqz7BGpBfysMiiLB3kJ?cluster=devnet) |
| Treasury (90/10 fee leg) | [AAb2TXLQCPFvnUoJFSBe9PFs28w5kvAukH4Gaiia3eiJ](https://explorer.solana.com/address/AAb2TXLQCPFvnUoJFSBe9PFs28w5kvAukH4Gaiia3eiJ?cluster=devnet) — share ATA [9DR2DFfn77Upc5rBpEvdP8LodAcjwBPELCygJYUZARoe](https://explorer.solana.com/address/9DR2DFfn77Upc5rBpEvdP8LodAcjwBPELCygJYUZARoe?cluster=devnet) |
| User2 (investor) | [48CUGMWkw49EDkVQBq5TEb3M43oej9bJf7z8aF3zA3bg](https://explorer.solana.com/address/48CUGMWkw49EDkVQBq5TEb3M43oej9bJf7z8aF3zA3bg?cluster=devnet) — share ATA [9G4xpk5W9Cpboxa1PoabKumHdVkUjE28zDn6wKModpAb](https://explorer.solana.com/address/9G4xpk5W9Cpboxa1PoabKumHdVkUjE28zDn6wKModpAb?cluster=devnet) |

Constituents on-chain (weights 4000/3200/2800 bps, fees entry 100 / exit 50 / mgmt 200 bps):

| Constituent | Vault ATA | Vault balance (raw) |
|---|---|---|
| NVDAx (4000 bps) | [WQFGhf6G6MuWqvysgDjDdB1oRwVTY1KXkFKHEYYpGZk](https://explorer.solana.com/address/WQFGhf6G6MuWqvysgDjDdB1oRwVTY1KXkFKHEYYpGZk?cluster=devnet) | 220,420,298,800 |
| AAPLx (3200 bps) | [CsL3H7egSD2AEBiqX5tg6kJFW7qfiSGpydDKKSrNb1GD](https://explorer.solana.com/address/CsL3H7egSD2AEBiqX5tg6kJFW7qfiSGpydDKKSrNb1GD?cluster=devnet) | 176,336,239,040 |
| MSFTx (2800 bps) | [H4QWQ4JryevtAB95bBiiZksTvFUSXkrTnn6Hscxh1YFS](https://explorer.solana.com/address/H4QWQ4JryevtAB95bBiiZksTvFUSXkrTnn6Hscxh1YFS?cluster=devnet) | 154,294,209,160 |

## 3. The 38 transactions (all confirmed, `err: null`)

Every signature below is a row in `devnet-evidence.json` → `txConfirmation[]` (`confirmed: true`). Key transactions are linked to the explorer; the full list with slots lives in the JSON.

### Deploys (3)

| Step | Signature | Slot |
|---|---|---|
| `whitelist` deploy | [5bqtoLM8t334F7hgVnRXFbY4rRGCQFmxJtWK1zcG35ZoMgzvmEc5GjVsVCdxos3Hu6P8YKH3xCgd3jteBMpE5WvZ](https://explorer.solana.com/tx/5bqtoLM8t334F7hgVnRXFbY4rRGCQFmxJtWK1zcG35ZoMgzvmEc5GjVsVCdxos3Hu6P8YKH3xCgd3jteBMpE5WvZ?cluster=devnet) | 493110585 |
| `basket_factory` deploy | [2UjmKe1asTUD7k8VDWyZGNCCBP5QZCreSkm7PnktwZZUkehkDn33Xxiev6SkVjtnwGZePAWStEErb9nD9TX4G541](https://explorer.solana.com/tx/2UjmKe1asTUD7k8VDWyZGNCCBP5QZCreSkm7PnktwZZUkehkDn33Xxiev6SkVjtnwGZePAWStEErb9nD9TX4G541?cluster=devnet) | 493110824 |
| `basket` deploy | [4iujRn32LQML5nath45sCKnB3JEaP4DPsCj6seY9kdjWdKWUSMeNmRH8vxkZjMkjqhDTpkqm4JMALx7q3RMaX7Xh](https://explorer.solana.com/tx/4iujRn32LQML5nath45sCKnB3JEaP4DPsCj6seY9kdjWdKWUSMeNmRH8vxkZjMkjqhDTpkqm4JMALx7q3RMaX7Xh?cluster=devnet) | 493111012 |

### Funding (1)

| Step | Signature | Slot |
|---|---|---|
| payer → user2, 1.5 SOL | [4ukp4NXyKkeAv5wpQMYDSMgjparkFmeTF8ZG8irF8KCWKpfksEcQAbb2fAcsUyADZkfqimNZEEfU2DZaKwjBPshV](https://explorer.solana.com/tx/4ukp4NXyKkeAv5wpQMYDSMgjparkFmeTF8ZG8irF8KCWKpfksEcQAbb2fAcsUyADZkfqimNZEEfU2DZaKwjBPshV?cluster=devnet) | 493111328 |

### Whitelist phase — mock xStocks creation (12, script `createWhitelist.ts`)

| Mint | Signature | Slot |
|---|---|---|
| TSLAx | `4i7dMDxAEnrMi9a3sqBjFQPNKtd5Gmtm5WFqsFPBrgahVcVM4XtRaA3RL5jbfc3LD1JUQaYThEHXDTgzBzEqbroF` | 493111421 |
| NVDAx | `Ho8F3pHpB66cUt28W1xS1a8Zp9FzGaCwmM1da9xTbqqqjUJN6SEj58FQPy7TVjArh89DqsqYLGQCv1yy5zVQoGk` | 493111428 |
| AAPLx | `38A4ntZo2fBTokHD95XvfAMo79YE1wfqo7PsRcmraAkBt9oXrvBewDHefmqcchPPguLkcesK4cbbtJu4DEZVxn1Z` | 493111436 |
| MSFTx | `cMb4NaCxTSc8aLeuy7Snr6x939LWAuJgDmJMQc1RNTqnaTAyD51oVsu1vcrDE1MiCuV7qUwvjeFcVCTta4C4c6n` | 493111444 |
| AMZNx | `5SmXd9RP7RQQoBH67q3VBENvR8LQaTABK5YceQu21iB6niGm3em8kUM1PYX5J5NVo5Pn7rC72erYVHQs3EwATqas` | 493111495 |
| GOOGLx | `2jj3Jf2srrQe16R8Q3ARf6aNTAGkwKts6oCSwzbrYN4Rbtx6xNnbfcSNBUDncQKo5zunpLrr6xRJrXSifmHKk2cR` | 493113180 |
| METAx | `5TDKaJt5KumoiSQTu7TkALEhAz7qGFR7WoP8HGNi8JwQPba4RwiwLAGjzLr6uv794LKygjjzpcj8BG71y2YYGNEs` | 493113203 |
| AMDx | `5zkVbgLotcKZ899G9r76benpnDD2PaEFtiHW7ccntJ5ipQtCP7payShpw4iZ22oPHAhQ6oc4qKWmidD5ubwcSoYw` | 493113256 |
| COINx | `2Qj6SzWQZVvHtztf2snTDdhpQcyztDNcbNfcyrvzDuvjFgV2JPkPjY6XTFVcywsDcqs4vUnApoSyZU9LeY4fxid5` | 493113277 |
| MSTRx | `4MbScbQ3hjzEqmzFJ7XtR9uF6RkHpsdskTY3KRzh6VVRPtBxos38Fu3PBZP5pnyBeQM69Cz5WKDqq2VJDw61QFX5` | 493113640 |
| HOODx | `3i4Q2x7XacpoGP5a4Q8ss6FjwXUW5LSiXAGXNWEi9cyWChuY6BBnLgVZiJDoBUJqRbUrLrL5yXPiKuudF4VbXirM` | 493113719 |
| SPYx | `3NDJrXvH4YMxVUvUSmdQ476ui2C1wkeVyMuJzST1pU5GuHqNxKbY8q6a4yPPHNqz33FXXsfp1Tjx4joHixrhkNqR` | 493113980 |

### Whitelist phase — program calls (13, script `createWhitelist.ts`)

| Step | Signature | Slot |
|---|---|---|
| `init_config` | [JnTVkWGXDikbSDXkCcarwUApsgN4eWocfMterjetsVYYExSHNnLHKBpBjdFzSWwj6NTiYwN8YDMxWSv1LKLBU7d](https://explorer.solana.com/tx/JnTVkWGXDikbSDXkCcarwUApsgN4eWocfMterjetsVYYExSHNnLHKBpBjdFzSWwj6NTiYwN8YDMxWSv1LKLBU7d?cluster=devnet) | 493113324 |
| `add_mint` TSLAx | `4mvUpSsb4nUpSMQdx61ygTSs9RyGwPpDuR52p1aWx2CWM1oBpEHQJXCjNdWLxNzHXjbyqfjEjWVNEsVUSv2ZTTuh` | 493113337 |
| `add_mint` NVDAx | `tiHp1q6Ln6fNjSranM4UvVLg1pBZE6VvXB1BXFXijd6VNDsMdtaLV6SRBn6Sze21bRwuK1eZ8sjYsLcDvxHCRUp` | 493113348 |
| `add_mint` AAPLx | `4ePArF7cvsSyyDENd5rsuRywy2GrUJjJd4cRGEkjjpU8BK282HLyebQ9gChnhJDHCihbDELcBZMbC3NpajKzSHYF` | 493113359 |
| `add_mint` MSFTx | `56jxTyZNowGcWoAbNazpwrdobayxhJqCaoaq2pLNMmrbWX4YaydhgZV5MxfBnrSCxZaZ5pbAPS1sjPXTAdwcHWuw` | 493113368 |
| `add_mint` AMZNx | `yvRSNLVm8AjuW1EerCzN4dmavp75P9NomghLwqCb5CHQdiVzAVTGh3AJySt2ZJb1jzU5g78DamAbregsUHJvDYx` | 493113379 |
| `add_mint` GOOGLx | `567u3GcqUYnpxb99EViS4Gmq7smxMLgd84fA8gQNqco2mP6AzYJaZiGKZbvzJpzBKSoEGyjnR3NN3rW2XanygeSo` | 493113389 |
| `add_mint` METAx | `3pmAYrng3Zyo3jaPPZ9RAJbFXeWax6adpJo54zwQxUEYWPwvUEVB7GesqZC2NhJhZtaVNLCzJErc6husFnFBiQyR` | 493113400 |
| `add_mint` AMDx | `bwhPgEEBVFzrhZVzFwCFxiTGAckPLshQxqFt7twFDFhMZ68s1rGdC4Ykoy8R3RndiN5rCTKdS16pnsTknpUgtNm` | 493113410 |
| `add_mint` COINx | `3tLicsuRfb4XZgmSGTTiGxHSQeRgabMK6GddWknUhnAEa9tDjWzbznFJX4SvoJemLnMATKo35TPvK5zpSi7vdyjs` | 493113421 |
| `add_mint` MSTRx | `4UY86LhHbRf4Nf3iWzurdYn3KUc15kXzzexvvswatNLpvDXAJw5ceFXtwRbtna22Yb73FJx9xTQtvAL4hD5YJKZk` | 493113829 |
| `add_mint` HOODx | `5tyxy24nU5zvLds2uCBc7b8ZCpdH6JpJX5QLvJcrGGn9RGCZBxwwp1FssFTCmVt9JBLLLrGzsr9UBGeYf7DJdEj4` | 493113848 |
| `add_mint` SPYx | `4rkpuNsjuR4WW9oejAbmmBzwGeJ5jZNWMq49JbRQifEiF77qoedMFfmHw7kCyBp2f5tJYaHHMzWLNYGuDFoQxVbP` | 493114016 |

### Factory + basket (2, script `createBasket.ts`, rung N=3)

| Step | Signature | Slot |
|---|---|---|
| `init_factory` (treasury, creator split 9000 bps) | [5ww9EeNafuopReGprN9DMFoaedwCsXKTadzk48DgbnicCdNwSwkw2cZHmai29PjvpMuEfuasujcyF1DxqbbkWyrL](https://explorer.solana.com/tx/5ww9EeNafuopReGprN9DMFoaedwCsXKTadzk48DgbnicCdNwSwkw2cZHmai29PjvpMuEfuasujcyF1DxqbbkWyrL?cluster=devnet) | 493114139 |
| `create_basket` (3 constituents, fees 100/50/200, genesis 1M) | [5bds3tN1ZwSUPAGxGif7EWAbpzRMni4DjbiRf6Q3H7iwmMRUzbNSpKfxAUSpGYEv7qXUv8F38LUASRX9dd1jojne](https://explorer.solana.com/tx/5bds3tN1ZwSUPAGxGif7EWAbpzRMni4DjbiRf6Q3H7iwmMRUzbNSpKfxAUSpGYEv7qXUv8F38LUASRX9dd1jojne?cluster=devnet) | 493114770 |

### Mint / redeem (6, script `mintAndRedeem.ts`)

| Step | Signature | Slot |
|---|---|---|
| user2 prep (ATAs + constituent funding) | [5Fm7tikfe2iGx4emTBGh3WMLpFBMQ662g5sxMSSqyrSWbJobSpvGPMp1SrCsUL3Gc4XoFH7fPfQTUic3WeZE9DLz](https://explorer.solana.com/tx/5Fm7tikfe2iGx4emTBGh3WMLpFBMQ662g5sxMSSqyrSWbJobSpvGPMp1SrCsUL3Gc4XoFH7fPfQTUic3WeZE9DLz?cluster=devnet) | 493114918 |
| `mint_in_kind` #1 (gross 100,000, entry fee 1,000, net 99,000) | [3U2YE7E2cPgna4qyiGzGTMN5EwDTZGig5cPCj8Fupn7Mnfp4XoLQzXpyHFkGPVRhbW3SYtcyDnAwGXHPJRhkXKf4](https://explorer.solana.com/tx/3U2YE7E2cPgna4qyiGzGTMN5EwDTZGig5cPCj8Fupn7Mnfp4XoLQzXpyHFkGPVRhbW3SYtcyDnAwGXHPJRhkXKf4?cluster=devnet) | 493114940 |
| `set_mint_paused` (NVDAx paused) | [4BWEB1pDonKVBLcc3cJbRRFFwYFUqLKCznsJ7BCtScUCEyZxCtPMPmPMYBWoPPey9waFxgdZ48UVrXMxjYbxH8mZ](https://explorer.solana.com/tx/4BWEB1pDonKVBLcc3cJbRRFFwYFUqLKCznsJ7BCtScUCEyZxCtPMPmPMYBWoPPey9waFxgdZ48UVrXMxjYbxH8mZ?cluster=devnet) | 493114961 |
| **`redeem_in_kind` while PAUSED** (burn 49,500, exit fee 247) | [pCMwfk7rpc5yYkCWUD26yh8EbqGHsnfVfBTXE2bv95ymfHisqKgHGB9KQqc3vKYKVJHEt5qf7uZJ9Z5uG6Lqxk2](https://explorer.solana.com/tx/pCMwfk7rpc5yYkCWUD26yh8EbqGHsnfVfBTXE2bv95ymfHisqKgHGB9KQqc3vKYKVJHEt5qf7uZJ9Z5uG6Lqxk2?cluster=devnet) | 493114981 |
| `set_mint_paused` (unpause) | [61y8oxH6xgwWmtj4jVLfWuRtKitowetz75r6hdXMV81HU1zNSNTRLikDHuvfvgvWWk95pCHLpzFmo2FmAqPwd1DC](https://explorer.solana.com/tx/61y8oxH6xgwWmtj4jVLfWuRtKitowetz75r6hdXMV81HU1zNSNTRLikDHuvfvgvWWk95pCHLpzFmo2FmAqPwd1DC?cluster=devnet) | 493115000 |
| `mint_in_kind` #2 top-up (gross 550,000,000, fee 5,500,000, net 544,500,000) | [7BBHTa6ztfC6veYQno4pg3rgk3ttyWQusDLtvSRT9V4yZYzCcYqYzJhiAqfFNGeQerg9LwP99HnNuAxAZidVw47](https://explorer.solana.com/tx/7BBHTa6ztfC6veYQno4pg3rgk3ttyWQusDLtvSRT9V4yZYzCcYqYzJhiAqfFNGeQerg9LwP99HnNuAxAZidVw47?cluster=devnet) | 493115047 |

### Fee (1, script `accrueFee.ts`)

| Step | Signature | Slot |
|---|---|---|
| `accrue_management_fee` (permissionless; +4 shares over 14 s elapsed) | [39Xfmog9sXahY7zAdxE97Uj9foEx8YQajZku4QkidVeFV44obvV6389g9iKjFE6LhvXhPC2rD8z9wQ3jxZAU23DC](https://explorer.solana.com/tx/39Xfmog9sXahY7zAdxE97Uj9foEx8YQajZku4QkidVeFV44obvV6389g9iKjFE6LhvXhPC2rD8z9wQ3jxZAU23DC?cluster=devnet) | 493115129 |

**Count check: 3 + 1 + 12 + 13 + 2 + 6 + 1 = 38.**

## 4. Reconciliation

### 4.1 Share supply — exact to the raw unit

| Event | Δ supply (raw) |
|---|---|
| `create_basket` genesis | +1,000,000 |
| `mint_in_kind` #1 (gross) | +100,000 |
| `mint_in_kind` #2 top-up (gross) | +550,000,000 |
| `redeem_in_kind` burn | −49,500 |
| exit-fee shares (50 bps of 49,500 = 247.5 → 247, floor) | +247 |
| management-fee shares (14 s elapsed) | +4 |
| **Computed total** | **551,050,751** |
| On-chain RPC `shareMintSupply` | **551,050,751** — exact match |

### 4.2 Fee split — 90/10 reconciles to the last share across 3 holders

Entry fee 100 bps collected on both mints, split creator 9000 / treasury 1000 bps; exit and mgmt fees minted to the same 90/10 legs.

| Holder | Genesis | Entry #1 fee (1,000 → 900/100) | Redeem exit fee (247 → 222/25) | Entry #2 fee (5,500,000 → 4,950,000/550,000) | Mgmt fee (4 → 3/1) | Balance (raw) |
|---|---|---|---|---|---|---|
| creator | 1,000,000 | 900 | 222 | 4,950,000 | 3 | **5,951,125** |
| treasury | — | 100 | 25 | 550,000 | 1 | **550,126** |
| user2 | — | 99,000 net | −49,500 burned | 544,500,000 net | — | **544,549,500** |

5,951,125 + 550,126 + 544,549,500 = **551,050,751** = on-chain supply. Zero remainder. The treasury holds **0 SOL by design** (never signs — AGENTS.md §2 #5); its 10% fee leg is proven by its share-ATA balance, not by lamports.

The redeem executed while NVDAx was `Paused` on the whitelist — the 247-share exit fee and pro-rata payout were still distributed (permissionless exit proven on a live chain).

### 4.3 NAV math

Backend NAV engine (BigInt fixed-point, `source: "onchain-indexed"`):

```
scaled vault holdings:  NVDAx 220,420.2988  AAPLx 176,336.23904  MSFTx 154,294.20916
mock prices:            NVDAx $180          AAPLx $230           MSFTx $420

NAV = 220,420.2988×180 + 176,336.23904×230 + 154,294.20916×420
    = 39,675,653.784 + 40,557,334.9792 + 64,803,567.8472
    = 145,036,556.6104 USD          (= API `nav`, = nav_snapshots row)

share_price = NAV / supply = 145,036,556.6104 / 551,050,751 = 0.263199998089 USD per raw base unit
            = 263.2 USD per scaled basket unit (10³ raw)
            = weighted price  180×0.40 + 230×0.32 + 420×0.28
            = 72.00 + 73.60 + 117.60 = 263.20  ✓
```

Actual vs target weights: `driftBps [0, 0, 0]` on all three legs (per AGENTS.md §17 basis).

## 5. Backend live against devnet

Started with the devnet profile (`backend/.env.devnet`, pid/log `/tmp/foliox-backend-devnet.log`, PID 62344 at capture). `/health`: `db connected + schemaApplied`, `indexer/navEngine/feeCrank` all `running: true`; `lastSlot 493115129` (= the fee-accrual tx), holdings fresh (`staleSeconds: 22`).

### 5.1 Row counts (Postgres `foliox_devnet`)

| Table | Rows | Notes |
|---|---|---|
| `baskets` | 1 | from on-chain decode (`source: "onchain-indexed"`) |
| `whitelisted_mints` | 12 | all 12 devnet mints, all `Active`, `price_source: mock:<sym>` |
| `events` | 5 | BasketCreated, Minted ×2, Redeemed, FeeAccrued |
| `user_positions` | 3 | user2 544,549,253 / treasury 550,126 / creator 4,951,125 |
| `position_events` | 4 | 2 Minted + 1 Redeemed + 1 FeeAccrued |
| `vault_holdings` | 3 | raw + multiplier(1) + scaled |
| `nav_snapshots` | 1 | latest: NAV 145,036,556.6104, share_price 0.263199998089 |

Note: the creator `user_positions` row (4,951,125) is event-derived and excludes the 1,000,000 genesis shares minted inside `create_basket` (a `BasketCreated`, not a `Minted` event); the on-chain ATA holds 5,951,125. Positions are an indexer convenience view — the reconciliation in §4 is against on-chain balances.

### 5.2 Real indexer bugs found and fixed during the live run

The devnet run surfaced three genuine indexer bugs (fixed in the same session; regressions added in `backend/tests/livewire.test.ts`):

1. **Event insert ordering + permanently dropped failed sigs** (`backend/src/indexer/listener.ts`): events were inserted before the `baskets` row existed (FK violation), and a signature that ever failed was `markSeen`-dropped forever. Now: baskets row upserted **before** event inserts, signatures processed **oldest-first**, failed sigs retried with a cap of 5.
2. **WhitelistedMint accounts never synced** (new `backend/src/indexer/whitelistSync.ts`): the `whitelisted_mints` table was populated only by seeds, never from chain. Now: a `whitelistSync` pass runs every 60 s, decoding on-chain WhitelistedMint accounts (disc + mint + decimals + watermark + status + price_source + bump).
3. **Holdings sync never wired + wrong PDA derivation** (`backend/src/indexer/holdingsSync.ts`): the sync pass wasn't invoked from the listener, and `deriveBasketPda` derived under the **basket** program id instead of the **factory** program id (baskets are factory-seeded PDAs). Now: corrected derivation, `deriveVaultAuthority` added, getVaultAtas owned by the vault authority, 30 s indexed-basket sync pass.

`npm --prefix backend test -- --run` after the fixes: **8 files, 421 tests, all passing**. Rust untouched by these fixes: 178 tests.

### 5.3 Fee crank — unsigned by construction (AGENTS.md §2 #5)

The crank runs hourly and **builds** `accrue_management_fee` transactions; it never signs. Invariant proof captured against the real indexed basket row + a live devnet blockhash:

- transaction `signatures` field: **0 entries** (versioned-tx placeholder, all-zero bytes)
- `feePayer`: `11111111111111111111111111111111` (placeholder — `FEE_CRANK_PAYER_PUBKEY` unset)
- instruction: `accrue_management_fee` @ `6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k`
- blockhash: `F3KzVfeSucMuZ12GowsXcqnsSe1WkmobsDcwQCHCastu`, estimated next accrual: 1,048 shares
- first scheduled tick fires once `basket.last_fee_accrual_ts` is >1 h old

## 6. Known limit — legacy wire size at 4+ constituents (not a program error)

`create_basket` passes 4 remaining accounts per constituent. On legacy transactions the serialized tx exceeds Solana's 1232-byte wire limit before it can ever reach the program:

| Ladder rung | Serialized size | Result |
|---|---|---|
| 6 constituents | 1618 B | rejected client-side (`Transaction too large: 1618 > 1232`, `logs/createBasket-N6.log`) |
| 5 constituents | 1444 B | rejected (`logs/createBasket-N5.log`) |
| 4 constituents | 1270 B | rejected (`logs/createBasket-N4.log`) |
| 3 constituents | — | **confirmed** — the live basket (`logs/createBasket-N3.log`) |

The full ladder 6→5→4→3 was tested. This is a client/transport limit, not an Anchor or program failure — nothing on-chain rejected anything. **Fix path:** versioned (v0) transactions + address lookup tables (ALTs) for the repeated WhitelistedMint/mint/ATA accounts. Deferred — recorded in plan.md §7 decision log.

## 7. Balances after the run

| Wallet | SOL | Role |
|---|---|---|
| [y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE](https://explorer.solana.com/address/y72KA263br7MtZw7BqC2dx5QYCBUciJGzShE8BRSwRE?cluster=devnet) (payer/creator) | 3.34204636 | started from the owner-funded 12 SOL; spent ~8.66 on deploys + rent + fees |
| [48CUGMWkw49EDkVQBq5TEb3M43oej9bJf7z8aF3zA3bg](https://explorer.solana.com/address/48CUGMWkw49EDkVQBq5TEb3M43oej9bJf7z8aF3zA3bg) (user2) | 1.49241580 | from the 1.5 SOL transfer |
| [AAb2TXLQCPFvnUoJFSBe9PFs28w5kvAukH4Gaiia3eiJ](https://explorer.solana.com/address/AAb2TXLQCPFvnUoJFSBe9PFs28w5kvAukH4Gaiia3eiJ) (treasury) | 0 | by design — treasury never signs; fee income lands in its share ATA (§4.2) |

## 8. How to reproduce

**Re-verify the live state (no SOL needed):**

```bash
# from repo root — regenerates scripts/.e2e-devnet/devnet-evidence.json from RPC
node scripts/.e2e-devnet/collect-evidence.mjs

# start the backend against devnet
cd backend && set -a && . ./.env.devnet && set +a && npx tsx src/index.ts
# then: curl localhost:3001/api/v1/health, /api/v1/baskets
```

**Full fresh run** — needs a *fresh* state dir (mock mints + basket PDA must not already exist) and a funded payer (devnet faucet is 429-limited; fund by transfer):

```bash
# env (repo root)
export FOLIOX_E2E_RPC_URL=https://api.devnet.solana.com
export FOLIOX_E2E_STATE_DIR="$PWD/scripts/.e2e-devnet-run2"        # fresh dir
export FOLIOX_E2E_PAYER=/path/to/funded-payer.json                  # keypair with ≥3 devnet SOL (not committed)
export FOLIOX_E2E_TREASURY="$PWD/scripts/.e2e-devnet/treasury.json" # independent treasury → observable 90/10 split

# the four E2E scripts, in order
npx tsx scripts/createWhitelist.ts        # 12 mock xStocks (ScaledUiAmountConfig) + init_config + add_mint ×12
FOLIOX_E2E_BASKET_N=3 npx tsx scripts/createBasket.ts   # init_factory + create_basket (N=3 is the live rung; 6/5/4 hit the wire limit, §6)
npx tsx scripts/mintAndRedeem.ts          # prep, mint_in_kind, pause → redeem_in_kind (proves permissionless exit), unpause, top-up mint
npx tsx scripts/accrueFee.ts              # permissionless management-fee accrual

# evidence
node scripts/.e2e-devnet/collect-evidence.mjs
```

Programs are already deployed at the declared IDs; a from-scratch redeploy uses `solana program deploy target/deploy/<name>.so --program-id target/deploy/<name>-keypair.json --url devnet` (×3) and a fresh `solana transfer <user2> 1.5 --url devnet`.

## Public demo deployment (2026-09-06)

The jury-facing frontend is on Vercel; the backend stays on this Mac and is exposed through a Cloudflare quick tunnel.

- **Frontend (Vercel):** https://foliox-app-coral.vercel.app (project `foliox-app`, account `yesildaladam`; per-deploy URLs like `https://foliox-<hash>-yesildaladams-projects.vercel.app` are also valid)
- **Backend (quick tunnel):** https://delight-closes-harley-driving.trycloudflare.com → `http://localhost:3001`
- Tunnel health at deploy time: `{"ok":true,"version":"0.1.0",...,"db":{"connected":true,"basketCount":3,...}}`
- End-to-end verified with headless Chrome: the deployed /explore page fetches `/api/v1/baskets?limit=100`, `/whitelist`, `/market/overview` from the tunnel origin and renders all 3 baskets; the buy page (`/basket/<pubkey>/buy`) also calls the tunnel origin.

### After a Mac reboot (tunnel URL CHANGES)

Quick-tunnel URLs are ephemeral — every restart produces a new `*.trycloudflare.com` host, and the Vercel env must be updated to match. Three commands:

```bash
# 1. start the stack (backend :3001 + frontend :3100, health-checked)
bash scripts/devnet-up.sh

# 2. start a fresh quick tunnel and read the new URL from the log
nohup cloudflared tunnel --url http://localhost:3001 > /tmp/foliox-tunnel.log 2>&1 &
grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/foliox-tunnel.log | head -1 | tee /tmp/foliox-tunnel-url

# 3. push the new URL into Vercel and redeploy (NEXT_PUBLIC_* are build-time)
NEW_URL=$(cat /tmp/foliox-tunnel-url)
cd app
printf "$NEW_URL" | npx vercel env rm NEXT_PUBLIC_API production --yes 2>/dev/null; printf "$NEW_URL" | npx vercel env add NEXT_PUBLIC_API production
printf "$NEW_URL" | npx vercel env rm NEXT_PUBLIC_API development --yes 2>/dev/null; printf "$NEW_URL" | npx vercel env add NEXT_PUBLIC_API development
npx vercel --prod --yes
```

**Follow-up:** a named Cloudflare tunnel (or any static domain in front of the Mac) would pin the URL and remove the redeploy step. `cloudflared` is installed via Homebrew (`brew services start cloudflared` can run it at login once a named tunnel is configured).

Deploy note: Vercel rejects builds on Next.js versions it flags as vulnerable; `app/` was upgraded next `15.1.0 → 15.5.25` on 2026-09-06 to pass that gate.
