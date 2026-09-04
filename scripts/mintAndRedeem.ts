/**
 * FolioX localnet/devnet E2E — step 3/4: mint in-kind + redeem in kind (second user).
 *
 * BASKET SELECTOR: FOLIOX_E2E_BASKET=<nonce> picks state.baskets[<nonce>];
 * unset = the newest basket (highest nonce). Works against any ladder rung.
 *
 * user2 (fresh keypair in the state dir):
 *   1. prep — user2 constituent ATAs created (mint_in_kind requires them to
 *      exist) + funded by the mock-mint authority (the payer);
 *   2. mint_in_kind proportional 10% of the vault — remaining_accounts use the
 *      4n layout: [mint, user_ata, vault_ata]×n triplets THEN n WhitelistedMint
 *      PDAs; asserts entry fee split 9000/1000 and net minted to user2;
 *   3. pauses constituent[0] on the whitelist, then REDEEMS half of user2's
 *      net shares with the 3n-only remaining-accounts layout — success while
 *      PAUSED proves redeem_in_kind has no whitelist gate; asserts floor
 *      pro-rata outputs;
 *   4. unpauses, then does a large top-up mint (gross target 550M shares) so
 *      the supply makes the management fee observable in seconds (step 4).
 *
 * WIRE FORMAT: for n >= 4 the mint_in_kind tx (12 + 4n accounts) exceeds the
 * 1232-byte legacy packet limit, so these sends go through lib.sendFitting —
 * legacy while it fits, v0 + Address Lookup Table when size demands it. The
 * ALT (authority = payer) is created/extended idempotently per basket.
 *
 * Everything derives from state.json (constituents, weights, seed amounts) —
 * no hard-coded constituent count, so the same script runs for the localnet
 * 3-constituent basket and any devnet ladder rung (6/5/4/3).
 *
 * All share math mirrors the program: u128-style BigInt, floor division.
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BASKET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAtaIdempotent,
  deriveAta,
  deriveVaultAuthority,
  deriveWhitelistedMint,
  ensureSol,
  fmtRaw,
  ixMintInKind,
  ixRedeemInKind,
  ixSetMintPaused,
  loadState,
  mintTo,
  newConnection,
  payerKeypair,
  readMint,
  readTokenAmount,
  saveState,
  selectBasket,
  send,
  sendFitting,
  stateKeypair,
  step,
  hasStepFailure,
} from "./lib.ts";

// 10% of each seeded amount — the basket constituents and seeds come from
// state.json (written by createBasket.ts), so this scales with any ladder rung.
const DEPOSIT_FRAC = 10n;
const REDEEM_FRAC = 2n; // redeem half of user2's net shares
const BIG_GROSS_TARGET = 550_000_000n; // top-up so the mgmt fee > 0 within seconds
const BIG_TOPUP_BUDGET = 3_200_000_000_000n; // per-constituent funding headroom for user2

function floorDiv(a: bigint, b: bigint): bigint {
  return a / b; // BigInt division already floors for non-negative values
}

async function main() {
  const conn = newConnection();
  const payer = payerKeypair(); // mock mint authority + whitelist authority
  const state = loadState();
  // Basket selector: FOLIOX_E2E_BASKET=<nonce> or the newest state.baskets entry.
  const { key: basketKey, entry } = selectBasket(state);
  console.log(`basket selector: FOLIOX_E2E_BASKET=${basketKey} (nonce ${entry.nonce ?? basketKey})`);
  const required: (keyof typeof entry)[] = ["basket", "shareMint", "creator", "treasury", "feesBps", "seedAmounts"];
  for (const k of required) {
    if (!entry[k]) throw new Error(`state.baskets[${basketKey}].${String(k)} missing — run scripts/createBasket.ts first`);
  }
  // The BASKET constituents (a subset of the whitelisted mocks) — prefer the
  // basket entry's constituents, fall back to the flat state.mints for the
  // pre-registry localnet state.
  const mints: PublicKey[] = (entry.constituents ?? state.mints).map((m: string) => new PublicKey(m));
  const seedAmounts: bigint[] = entry.seedAmounts!.map((s: string | number) => BigInt(s));
  if (seedAmounts.length !== mints.length) {
    throw new Error(`state mismatch: ${mints.length} constituents vs ${seedAmounts.length} seed amounts`);
  }
  const SMALL_DEPOSIT = seedAmounts.map((s) => s / DEPOSIT_FRAC); // exactly 10% of each seed
  const basket = new PublicKey(entry.basket);
  const shareMint = new PublicKey(entry.shareMint);
  const creator = new PublicKey(entry.creator);
  const treasury = new PublicKey(entry.treasury);
  const entryBps = entry.feesBps!.entry;
  const exitBps = entry.feesBps!.exit;
  const vaultAuthority = deriveVaultAuthority(basket);

  const user2 = stateKeypair("user2.json");

  // ALT payload for the flow txs on this basket: every account mint/redeem
  // touches EXCEPT the signing user (signers stay in static keys — sendFitting
  // filters them). Only created/extended when the legacy wire size demands it.
  const flowAltAddresses: (PublicKey | null | undefined)[] = [
    basket,
    shareMint,
    deriveAta(user2.publicKey, shareMint),
    vaultAuthority,
    creator,
    deriveAta(creator, shareMint),
    treasury,
    deriveAta(treasury, shareMint),
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    BASKET_PROGRAM_ID,
  ];
  mints.forEach((m) => {
    flowAltAddresses.push(m, deriveAta(user2.publicKey, m), deriveAta(vaultAuthority, m), deriveWhitelistedMint(m));
  });
  const altOpts = {
    altName: `flow-basket-${basketKey}`,
    altAddresses: flowAltAddresses,
    altAuthority: payer, // ALT management is paid/owned by the payer, not user2
  };
  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`user2: ${user2.publicKey.toBase58()}`);
  await ensureSol(conn, user2, 1, 5);

  const core = {
    basket,
    shareMint,
    user: user2.publicKey,
    creator,
    treasury,
    constituents: mints,
  };
  // Every tx signature for this run, recorded under state.flows[<basket key>].
  const flowSigs: Record<string, string> = {};

  async function readSupply(): Promise<bigint> {
    const m = await readMint(conn, shareMint);
    if (!m) throw new Error("share mint missing");
    return m.supply;
  }
  async function readVaults(): Promise<bigint[]> {
    const out: bigint[] = [];
    for (const m of mints) {
      const v = await readTokenAmount(conn, deriveAta(vaultAuthority, m));
      if (v === null) throw new Error(`vault ATA missing for ${m.toBase58()}`);
      out.push(v);
    }
    return out;
  }

  // ---- prep: user2 ATAs + funding ----
  await step("prep: user2 constituent ATAs + mint authority funding", async () => {
    const ixs = mints.map((m) => createAtaIdempotent(user2.publicKey, user2.publicKey, m));
    ixs.push(
      ...mints.map((m, i) =>
        mintTo(m, deriveAta(user2.publicKey, m), payer.publicKey, SMALL_DEPOSIT[i] + BIG_TOPUP_BUDGET),
      ),
    );
    flowSigs.prep = await send(conn, "prep_user2", ixs, [payer, user2]);
    for (let i = 0; i < mints.length; i++) {
      const bal = await readTokenAmount(conn, deriveAta(user2.publicKey, mints[i]));
      if (bal === null || bal < SMALL_DEPOSIT[i] + BIG_TOPUP_BUDGET) {
        throw new Error(`user2 ATA[${i}] funding failed`);
      }
      console.log(`  user2 ATA[${i}] = ${fmtRaw(bal!)}`);
    }
  });

  // ---- small proportional mint (10% of vault, 4n remaining accounts) ----
  await step(`mint_in_kind 10% of vault (4n remaining accounts: ${mints.length} triplets + ${mints.length} whitelist PDAs)`, async () => {
    const supplyBefore = await readSupply();
    const vaults = await readVaults();
    console.log(`  supply=${supplyBefore} vault=[${vaults.join(", ")}]`);

    // expected math (mirrors math::gross_shares + fees)
    const grosses = SMALL_DEPOSIT.map((d, i) => floorDiv(d * supplyBefore, vaults[i]));
    const gross = grosses.reduce((a, b) => (b < a ? b : a));
    const spread = grosses.reduce((a, b) => (b > a ? b : a)) - gross;
    if (spread * 100n > gross) throw new Error("internal: deposits exceed the 1% tolerance — test bug");
    const entryFee = floorDiv(gross * BigInt(entryBps), 10_000n);
    const net = gross - entryFee;
    const creatorFee = floorDiv(entryFee * 9000n, 10_000n);
    const treasuryFee = entryFee - creatorFee;
    console.log(
      `  expected: gross=${gross} entry_fee=${entryFee} (creator ${creatorFee} / treasury ${treasuryFee}) net=${net}`,
    );

    const ix = ixMintInKind(core, SMALL_DEPOSIT, vaults);
    if (ix.keys.length !== 12 + 4 * mints.length) {
      throw new Error(`4n layout broken: ${ix.keys.length} keys != ${12 + 4 * mints.length}`);
    }
    // v0+ALT automatically when the legacy wire size exceeds 1232B (n >= 4).
    const sig = await sendFitting(conn, "mint_in_kind", [ix], [user2], altOpts);
    flowSigs.mint = sig.signature;
    console.log(`  mint_in_kind signature: ${sig.signature} (wire: ${sig.wire}${sig.v0Size ? ` ${sig.legacySize}B→${sig.v0Size}B` : `, ${sig.legacySize}B`})`);

    const userShareBal = await readTokenAmount(conn, deriveAta(user2.publicKey, shareMint));
    if (userShareBal !== net) throw new Error(`user2 share balance ${userShareBal} != net ${net}`);
    const supplyAfter = await readSupply();
    if (supplyAfter !== supplyBefore + gross) {
      throw new Error(`supply ${supplyAfter} != ${supplyBefore} + ${gross}`);
    }
    const creatorBal = await readTokenAmount(conn, deriveAta(creator, shareMint));
    const treasuryBal = await readTokenAmount(conn, deriveAta(treasury, shareMint));
    console.log(`  user2 shares = ${fmtRaw(userShareBal!)}`);
    console.log(`  creator share ATA = ${creatorBal} | treasury share ATA = ${treasuryBal} (supply ${supplyAfter})`);
    if (creator.equals(treasury)) {
      if ((creatorBal ?? 0n) !== (treasuryBal ?? 0n) || (creatorBal ?? 0n) !== entryFee) {
        throw new Error("creator==treasury fee pool mismatch");
      }
      console.log("  NOTE: creator == treasury — the 90/10 split is summed in one ATA");
    } else {
      const c0 = creatorBal! - GENESIS;
      const t0 = treasuryBal!;
      if (c0 !== creatorFee || t0 !== treasuryFee) {
        throw new Error(`fee split mismatch: creator ${c0}!=${creatorFee}, treasury ${t0}!=${treasuryFee}`);
      }
      console.log(`  90/10 split verified: creator ${c0} / treasury ${t0}`);
    }
  });

  // ---- redeem WHILE CONSTITUENT[0] IS PAUSED (no whitelist gate on redeem) ----
  await step("whitelist pause_mint(constituent[0])", async () => {
    flowSigs.pause = await send(conn, "pause_mint", [ixSetMintPaused(payer.publicKey, mints[0], true)], [payer]);
    const rec = await conn.getAccountInfo(deriveWhitelistedMint(mints[0]));
    if (!rec || rec.data[49] !== 1) throw new Error("constituent[0] not PausedNewMints (byte 49)");
    console.log(`  ${mints[0].toBase58()} is now PausedNewMints`);
  });

  await step(`redeem_in_kind half of user2's net shares (3n remaining accounts, NO whitelist PDA)`, async () => {
    const supplyBefore = await readSupply(); // S_before for pro-rata math
    const vaults = await readVaults();
    const userShareBal = (await readTokenAmount(conn, deriveAta(user2.publicKey, shareMint)))!;
    // Redeem half of whatever user2 actually holds (net of the entry fee).
    const REDEEM_SHARES = userShareBal / REDEEM_FRAC;
    if (REDEEM_SHARES === 0n) throw new Error("user2 share balance too small to redeem half");

    const exitFee = floorDiv(REDEEM_SHARES * BigInt(exitBps), 10_000n);
    const burn = REDEEM_SHARES - exitFee;
    const outs = vaults.map((v) => floorDiv(v * burn, supplyBefore));
    console.log(`  S_before=${supplyBefore} vault=[${vaults.join(", ")}]`);
    console.log(`  expected: exit_fee=${exitFee} burn=${burn} outs=[${outs.join(", ")}]`);

    const ix = ixRedeemInKind(core, REDEEM_SHARES, vaults);
    if (ix.keys.length !== 12 + 3 * mints.length) {
      throw new Error(`3n layout broken: ${ix.keys.length} keys != ${12 + 3 * mints.length}`);
    }
    const hasWhitelistPda = ix.keys.some((k) =>
      mints.some((m) => k.pubkey.equals(deriveWhitelistedMint(m))),
    );
    if (hasWhitelistPda) throw new Error("redeem tx unexpectedly contains a WhitelistedMint PDA");
    console.log(
      `  structural check: ${ix.keys.length} accounts, NO whitelist PDA — and constituent[0] is PAUSED on-chain`,
    );
    // user2's constituent ATAs still hold the leftover top-up funding, so the
    // post-redeem check must compare DELTAS, not absolute balances.
    const tokenBalBefore: bigint[] = [];
    for (const m of mints) {
      const b = await readTokenAmount(conn, deriveAta(user2.publicKey, m));
      if (b === null) throw new Error(`user2 ATA missing for ${m.toBase58()}`);
      tokenBalBefore.push(b);
    }
    const redeemSig = await sendFitting(conn, "redeem_in_kind", [ix], [user2], altOpts);
    flowSigs.redeem = redeemSig.signature;
    console.log(`  redeem_in_kind signature: ${redeemSig.signature} (wire: ${redeemSig.wire}${redeemSig.v0Size ? ` ${redeemSig.legacySize}B→${redeemSig.v0Size}B` : `, ${redeemSig.legacySize}B`})`);

    // verify received amounts match the floor math exactly
    for (let i = 0; i < mints.length; i++) {
      const bal = (await readTokenAmount(conn, deriveAta(user2.publicKey, mints[i])))!;
      const received = bal - tokenBalBefore[i];
      if (received !== outs[i]) {
        throw new Error(`user2 token[${i}] received ${received} != expected out ${outs[i]}`);
      }
      console.log(`  out[${i}] = ${fmtRaw(outs[i])} (received exactly)`);
    }
    const shareBalAfter = await readTokenAmount(conn, deriveAta(user2.publicKey, shareMint));
    if (shareBalAfter !== userShareBal - REDEEM_SHARES) {
      throw new Error(`share balance after redeem ${shareBalAfter} != ${userShareBal} - ${REDEEM_SHARES}`);
    }
    const supplyAfter = await readSupply();
    if (supplyAfter !== supplyBefore - burn) {
      throw new Error(`supply after redeem ${supplyAfter} != ${supplyBefore} - ${burn}`);
    }
    console.log("  REDEEM NOT GATED: succeeded while a constituent whitelist entry was PausedNewMints");
    console.log(`  user2 shares left = ${shareBalAfter} | supply = ${supplyAfter}`);
  });

  await step("whitelist unpause_mint(constituent[0])", async () => {
    flowSigs.unpause = await send(conn, "unpause_mint", [ixSetMintPaused(payer.publicKey, mints[0], false)], [payer]);
    const rec = await conn.getAccountInfo(deriveWhitelistedMint(mints[0]));
    if (!rec || rec.data[49] !== 0) throw new Error("constituent[0] not Active after unpause");
  });

  // ---- large top-up mint so the management fee is observable quickly ----
  await step("mint_in_kind top-up (gross target 550M shares) — makes step 4's fee observable in seconds", async () => {
    const supplyBefore = await readSupply();
    const vaults = await readVaults();
    // D_j = ceil(G * V_j / S) keeps every D_j*S/V_j >= G (min >= G, spread ~0)
    const deposits = vaults.map((v) => {
      const d = floorDiv(BIG_GROSS_TARGET * v, supplyBefore);
      return d * supplyBefore < BIG_GROSS_TARGET * v ? d + 1n : d;
    });
    const grosses = deposits.map((d, i) => floorDiv(d * supplyBefore, vaults[i]));
    const gross = grosses.reduce((a, b) => (b < a ? b : a));
    const spread = grosses.reduce((a, b) => (b > a ? b : a)) - gross;
    if (spread * 100n > gross) throw new Error("top-up deposits exceed the 1% tolerance — test bug");
    console.log(`  supply=${supplyBefore} deposits=[${deposits.join(", ")}] expected gross>=${gross}`);
    if (deposits.some((d, i) => d > SMALL_DEPOSIT[i] + BIG_TOPUP_BUDGET)) {
      throw new Error("top-up deposit exceeds user2 funding — test bug");
    }

    const sig = await sendFitting(conn, "mint_in_kind_topup", [ixMintInKind(core, deposits, vaults)], [user2], altOpts);
    flowSigs.topupMint = sig.signature;
    console.log(`  mint_in_kind_topup signature: ${sig.signature} (wire: ${sig.wire})`);

    const supplyAfter = await readSupply();
    const userShareBal = await readTokenAmount(conn, deriveAta(user2.publicKey, shareMint));
    console.log(`  supply ${supplyBefore} -> ${supplyAfter} (minted ${supplyAfter - supplyBefore})`);
    console.log(`  user2 shares now = ${fmtRaw(userShareBal!)}`);
  });

  saveState({
    user2: user2.publicKey.toBase58(),
    flows: { ...(state.flows ?? {}), [basketKey]: { ...((state.flows ?? {})[basketKey] ?? {}), ...flowSigs } },
  });

  if (hasStepFailure()) process.exit(1);
}

const GENESIS = 1_000_000n; // creator share ATA starts at GENESIS_SHARES

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
