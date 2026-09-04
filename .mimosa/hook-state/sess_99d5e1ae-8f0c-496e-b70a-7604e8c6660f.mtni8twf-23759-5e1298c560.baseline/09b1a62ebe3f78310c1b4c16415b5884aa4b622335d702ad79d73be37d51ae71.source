/**
 * FolioX localnet/devnet E2E — step 2/4: factory + basket.
 *
 *   - init_factory(treasury, creator_split=9000) — factory caps are hardcoded
 *     on-chain at 300/100/300 (entry/exit/mgmt) and echoed in the output.
 *   - create_basket(nonce, constituents from the LADDER below — default 6
 *     ("MAG SIX": NVDAx 2500 / AAPLx 2000 / MSFTx 1500 / METAx 1500 / AMZNx
 *     1250 / GOOGLx 1250 bps), fees 100/50/200 bps, metadata_hash =
 *     sha256(json blob), seed amounts proportional to weights) passing
 *     remaining_accounts per constituent in the factory's exact context order:
 *         [WhitelistedMint PDA, mint, creator_ata, vault_ata]
 *     (programs/basket_factory/src/lib.rs ACCOUNTS_PER_CONSTITUENT = 4).
 *
 * NONCE: FOLIOX_E2E_BASKET_NONCE overrides; default = the factory's on-chain
 * basket_count (the next free nonce — 1 while the nonce-0 basket is live).
 * Each run records its basket under state.baskets[<nonce>] (top-level keys
 * keep describing the newest basket for the older scripts).
 *
 * WIRE FORMAT (the 3-constituent ceiling): a legacy tx tops out at the
 * 1232-byte Solana packet size — measured create_basket sizes: 6→1618B,
 * 5→1444B, 4→1270B, 3→1096B. For n >= 4 this script compiles the SAME
 * instruction into a v0 message whose non-signer keys are compressed through
 * an Address Lookup Table (factory + programs + basket PDAs + every
 * constituent mint/ATA), logs both serialized sizes before sending, and falls
 * back to a second extended ALT if a single table still doesn't fit. The
 * programs themselves are unchanged — no redeploy.
 *
 * FOLIOX_E2E_BASKET_N (6|5|4|3) steps down the ladder if devnet rejects the
 * bigger baskets; weights are pre-arranged per rung to still sum to 10000.
 *
 * The instruction seeds the vaults atomically (transfer_checked creator→vault)
 * and mints GENESIS_SHARES = 1,000,000 to the creator; the share mint authority
 * ends at the basket program's vault authority PDA [b"basket", basket].
 *
 * Treasury: defaults to the payer (per the plan's example flow). With
 * creator==treasury the two share-fee ATAs coincide, so the 90/10 split is not
 * separately observable on-chain — set FOLIOX_E2E_TREASURY=<keypair file> (the
 * e2e.sh flow does) to get an independent treasury wallet whose share ATA
 * proves the 10% leg. The treasury wallet never needs to sign or hold SOL.
 *
 * State written: factory, basket, shareMint, vaultAuthority, creator,
 * treasury, fees, weights, seedAmounts, baskets{<nonce>}, alts.
 */

import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BASKET_PROGRAM_ID,
  PACKET_LIMIT,
  TOKEN_2022_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  deriveAta,
  deriveBasketPda,
  deriveFactoryConfig,
  deriveShareMint,
  deriveVaultAuthority,
  deriveWhitelistedMint,
  ensureSol,
  E2E_COMPUTE_UNITS,
  envKeypair,
  fmtRaw,
  getOrCreateAlt,
  ixCreateBasket,
  ixInitFactory,
  legacyWireSize,
  loadLookupTables,
  loadState,
  newConnection,
  payerKeypair,
  readMint,
  readTokenAmount,
  saveState,
  send,
  sendVersioned,
  serializedTxSize,
  stateDir,
  step,
  hasStepFailure,
  toVersionedTx,
} from "./lib.ts";

const CREATOR_FEE_SPLIT_BPS = 9000;
const ENTRY_FEE_BPS = 100;
const EXIT_FEE_BPS = 50;
const MGMT_FEE_BPS = 200;
const GENESIS_SHARES = 1_000_000n;

/**
 * Constituent ladder — the flagship "MAG SIX" basket is 6 constituents
 * (weights sum 10000). Devnet limits (transaction wire size 1232B and the
 * account-frame budget) may reject the top rungs; FOLIOX_E2E_BASKET_N steps
 * down the ladder (6 → 5 → 4 → 3). Seeds stay proportional to weights
 * (seed_raw = weight_bps × 100_000, so 10000 bps ↔ 1_000_000_000 raw total).
 */
const LADDER: Record<number, { symbol: string; weightBps: number }[]> = {
  6: [
    { symbol: "NVDAx", weightBps: 2500 },
    { symbol: "AAPLx", weightBps: 2000 },
    { symbol: "MSFTx", weightBps: 1500 },
    { symbol: "METAx", weightBps: 1500 },
    { symbol: "AMZNx", weightBps: 1250 },
    { symbol: "GOOGLx", weightBps: 1250 },
  ],
  5: [
    { symbol: "NVDAx", weightBps: 2600 },
    { symbol: "AAPLx", weightBps: 2200 },
    { symbol: "MSFTx", weightBps: 1800 },
    { symbol: "METAx", weightBps: 1700 },
    { symbol: "AMZNx", weightBps: 1700 },
  ],
  4: [
    { symbol: "NVDAx", weightBps: 3000 },
    { symbol: "AAPLx", weightBps: 2700 },
    { symbol: "MSFTx", weightBps: 2300 },
    { symbol: "METAx", weightBps: 2000 },
  ],
  3: [
    { symbol: "NVDAx", weightBps: 4000 },
    { symbol: "AAPLx", weightBps: 3200 },
    { symbol: "MSFTx", weightBps: 2800 },
  ],
};

const BASKET_N = Number(process.env.FOLIOX_E2E_BASKET_N || 6);
if (!LADDER[BASKET_N]) {
  throw new Error(`FOLIOX_E2E_BASKET_N=${BASKET_N} invalid — pick one of ${Object.keys(LADDER).join("/")}`);
}
const CONSTITUENTS = LADDER[BASKET_N];
const WEIGHTS = CONSTITUENTS.map((c) => c.weightBps);
const SEED_AMOUNTS = WEIGHTS.map((w) => BigInt(w) * 100_000n);

const METADATA_BLOB = JSON.stringify({
  name: "FolioX Demo Basket",
  symbol: "FDX",
  version: "devnet-e2e",
  constituents: CONSTITUENTS.map((c) => ({ symbol: c.symbol, weight_bps: c.weightBps })),
  note: "mock devnet basket — NOT an ETF, demo data only",
});

async function main() {
  const conn = newConnection();
  const payer = payerKeypair(); // factory authority + basket creator
  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`creator/payer: ${payer.publicKey.toBase58()}`);
  await ensureSol(conn, payer, 2, 10);

  const state = loadState();
  const allMints: string[] = state.mints || [];
  const allSymbols: string[] = state.mockSymbols || [];
  if (allMints.length === 0) throw new Error("run scripts/createWhitelist.ts first (mock mints expected)");
  // The basket constituents are a subset of the whitelisted mocks, picked by
  // symbol so the whitelist mint count (12) can exceed the basket size.
  const basketMints = CONSTITUENTS.map((c) => {
    const idx = allSymbols.indexOf(c.symbol);
    if (idx < 0) throw new Error(`constituent ${c.symbol} not found in state.mockSymbols — run createWhitelist.ts`);
    return new PublicKey(allMints[idx]);
  });
  const mints = basketMints; // the create_basket constituent list

  // Treasury: payer by default, or an independent generated keypair
  // (FOLIOX_E2E_TREASURY=<keypair file>) so the 90/10 fee split is
  // separately observable. The treasury never needs to sign or hold SOL.
  const treasuryKp = envKeypair("FOLIOX_E2E_TREASURY");
  const treasury = treasuryKp ? treasuryKp.publicKey : payer.publicKey;
  if (treasuryKp) {
    fs.writeFileSync(
      path.join(stateDir(), "treasury.json"),
      JSON.stringify(Array.from(treasuryKp.secretKey)),
    );
    console.log(`treasury: ${treasury.toBase58()} (independent wallet — fee split observable)`);
  } else {
    console.log(
      `treasury: ${treasury.toBase58()} (= payer; creator_share_ata == treasury_share_ata, only the fee SUM is observable)`,
    );
  }

  const factory = deriveFactoryConfig();
  // Nonce: FOLIOX_E2E_BASKET_NONCE overrides; default = the factory's on-chain
  // basket_count (FactoryConfig layout: 8 disc + authority 32 + treasury 32 +
  // split u16 + 3 fee-cap u16s = 80 → basket_count u64 @80), i.e. the next
  // free basket index.
  const nonceEnv = process.env.FOLIOX_E2E_BASKET_NONCE;
  let NONCE: bigint;
  if (nonceEnv !== undefined && nonceEnv !== "") {
    NONCE = BigInt(nonceEnv);
    console.log(`nonce: ${NONCE} (FOLIOX_E2E_BASKET_NONCE)`);
  } else {
    const fInfo = await conn.getAccountInfo(factory);
    NONCE = fInfo ? fInfo.data.readBigUInt64LE(80) : 0n;
    console.log(`nonce: ${NONCE} (factory basket_count @${factory.toBase58()})`);
  }
  const creator = payer.publicKey;
  const basket = deriveBasketPda(factory, creator, NONCE);
  const shareMint = deriveShareMint(basket);
  const vaultAuthority = deriveVaultAuthority(basket);
  const metadataHash = createHash("sha256").update(METADATA_BLOB).digest();
  let createSig = "";

  await step("factory init_factory(treasury, split 9000)", async () => {
    if (await conn.getAccountInfo(factory)) {
      console.log(`  factory exists (${factory.toBase58()}) — skipping init`);
      return;
    }
    await send(conn, "init_factory", [ixInitFactory(creator, treasury, CREATOR_FEE_SPLIT_BPS)], [payer]);
    const info = await conn.getAccountInfo(factory);
    if (!info) throw new Error("factory not created");
    // FactoryConfig: 8 disc + authority 32 + treasury 32 + split u16 @72.
    const storedTreasury = new PublicKey(info.data.subarray(40, 72));
    const storedSplit = info.data.readUInt16LE(72);
    if (!storedTreasury.equals(treasury)) throw new Error("factory treasury mismatch");
    if (storedSplit !== CREATOR_FEE_SPLIT_BPS) throw new Error("factory split mismatch");
    console.log(
      `  factory ${factory.toBase58()} treasury=${treasury.toBase58()} split=${storedSplit} caps=300/100/300 (on-chain defaults)`,
    );
  });

  await step(
    `create_basket nonce=${NONCE} ${CONSTITUENTS.length} xStocks (${CONSTITUENTS.map((c) => c.symbol).join("/")} = ${WEIGHTS.join("/")}), fees 100/50/200`,
    async () => {
      if (await conn.getAccountInfo(basket)) {
        throw new Error(`basket PDA already exists (${basket.toBase58()}) — fresh state required`);
      }
      // Sanity-log the remaining_accounts layout we are about to pass.
      console.log("  remaining_accounts per constituent: [WhitelistedMint PDA, mint, creator_ata, vault_ata]");
      for (const m of mints) {
        console.log(`    ${m.toBase58()} wl=${deriveWhitelistedMint(m).toBase58()}`);
      }
      const createIx = ixCreateBasket({
        creator,
        nonce: NONCE,
        constituents: mints,
        weightsBps: WEIGHTS,
        entryFeeBps: ENTRY_FEE_BPS,
        exitFeeBps: EXIT_FEE_BPS,
        managementFeeBps: MGMT_FEE_BPS,
        metadataHash,
        seedAmounts: SEED_AMOUNTS,
        shareMint,
        basket,
      });
      // WIRE GATE: n <= 3 keeps the legacy path (existing proofs stay
      // byte-reproducible); n >= 4 compiles the SAME instruction into a v0
      // message whose non-signer keys are compressed through an ALT.
      const useV0 = CONSTITUENTS.length >= 4;
      if (!useV0) {
        try {
          // The compute-unit limit comes from lib.ts send() — the atomic deploy
          // (share mint + basket init CPI + n vault ATAs + seed transfers +
          // genesis mint + authority handoff) exceeds the 200k default budget.
          await send(conn, "create_basket", [createIx], [payer]);
        } catch (err) {
          // A failed tx has no on-chain effect, so re-simulating reproduces the
          // failure and surfaces the program logs (silent 3xxx codes otherwise).
          console.error(`  create_basket send failed: ${err}`);
          try {
            const sim = await conn.simulateTransaction(
              new Transaction().add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: E2E_COMPUTE_UNITS }),
                createIx,
              ),
              [payer],
            );
            console.error(`  simulation err: ${JSON.stringify(sim.value.err)}`);
            for (const line of sim.value.logs ?? []) console.error(`    ${line}`);
          } catch (simErr) {
            console.error(`  simulation itself failed: ${simErr}`);
          }
          throw err;
        }
      } else {
        // --- v0 + Address Lookup Table path (n >= 4) ---
        const legacySize = legacyWireSize([createIx], payer.publicKey);
        console.log(`  wire: legacy create_basket = ${legacySize}B (packet limit ${PACKET_LIMIT}B)`);
        // Every address the tx references EXCEPT the payer/signer: named
        // accounts + the CPI target program + per-constituent [wlPda, mint,
        // creator_ata, vault_ata]. Program ids may live in a v0 lookup table.
        const altAddresses: PublicKey[] = [
          deriveFactoryConfig(),
          basket,
          shareMint,
          vaultAuthority,
          deriveAta(creator, shareMint),
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
          SYSTEM_PROGRAM_ID,
          BASKET_PROGRAM_ID,
        ];
        mints.forEach((mint) => {
          altAddresses.push(
            deriveWhitelistedMint(mint),
            mint,
            deriveAta(creator, mint),
            deriveAta(vaultAuthority, mint),
          );
        });
        const altName = `create-basket-nonce-${NONCE}`;
        const alt1 = await getOrCreateAlt(conn, payer, altName, altAddresses);
        let altAddressesLoaded = await loadLookupTables(conn, [alt1.address]);
        let tx = toVersionedTx([createIx], altAddressesLoaded, creator, (await conn.getLatestBlockhash()).blockhash);
        let v0Size = serializedTxSize(tx);
        console.log(`  wire: v0+ALT ${alt1.address.toBase58()} = ${v0Size}B`);
        if (v0Size > PACKET_LIMIT) {
          // Fallback: a second, freshly extended ALT with the same address set.
          console.log(`  wire: v0+ALT still over the limit — retrying with a second extended ALT`);
          const alt2 = await getOrCreateAlt(conn, payer, `${altName}-alt2`, altAddresses);
          altAddressesLoaded = alt2.address.equals(alt1.address)
            ? altAddressesLoaded
            : [...altAddressesLoaded, ...(await loadLookupTables(conn, [alt2.address]))];
          tx = toVersionedTx([createIx], altAddressesLoaded, creator, (await conn.getLatestBlockhash()).blockhash);
          v0Size = serializedTxSize(tx);
          console.log(
            `  wire: v0+ALTs[${altAddressesLoaded.map((t) => t.key.toBase58()).join(", ")}] = ${v0Size}B`,
          );
          if (v0Size > PACKET_LIMIT) {
            throw new Error(`v0 create_basket does not fit even with two ALTs (${v0Size}B)`);
          }
        }
        try {
          const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
          createSig = await sendVersioned(
            conn,
            "create_basket",
            tx,
            [payer],
            { blockhash, lastValidBlockHeight },
            (freshBlockhash) => toVersionedTx([createIx], altAddressesLoaded, creator, freshBlockhash),
          );
        } catch (err) {
          // A failed tx has no on-chain effect; re-simulate the versioned tx to
          // surface the program logs.
          console.error(`  create_basket send failed: ${err}`);
          try {
            const simTx = toVersionedTx(
              [createIx],
              altAddressesLoaded,
              creator,
              (await conn.getLatestBlockhash()).blockhash,
            );
            const sim = await conn.simulateTransaction(simTx, { sigVerify: false, replaceRecentBlockhash: true });
            console.error(`  simulation err: ${JSON.stringify(sim.value.err)}`);
            for (const line of sim.value.logs ?? []) console.error(`    ${line}`);
          } catch (simErr) {
            console.error(`  simulation itself failed: ${simErr}`);
          }
          throw err;
        }
        console.log(`  create_basket tx signature: ${createSig}`);
      }
    },
  );

  await step("verify basket state (genesis 1,000,000 shares, seeds in vault, share-mint authority = vault PDA)", async () => {
    const info = await conn.getAccountInfo(basket);
    if (!info) throw new Error("basket account missing");
    // Basket layout offsets: disc 8, factory 8..40, creator 40..72, treasury
    // 72..104, share_mint 104..136, nonce 136..144, created_at 144..152,
    // last_fee_accrual_ts 152..160, metadata 160..192, num 192, constituents
    // 193..833, weights 833..873, entry 873..875, exit 875..877, mgmt 877..879.
    const d = info.data;
    const storedShareMint = new PublicKey(d.subarray(104, 136));
    const numConstituents = d[192];
    const storedEntry = d.readUInt16LE(873);
    const storedExit = d.readUInt16LE(875);
    const storedMgmt = d.readUInt16LE(877);
    const lastAccrual = Number(d.readBigInt64LE(152));
    if (!storedShareMint.equals(shareMint)) throw new Error("basket.share_mint mismatch");
    if (numConstituents !== CONSTITUENTS.length) {
      throw new Error(`num_constituents ${numConstituents} != ${CONSTITUENTS.length}`);
    }
    if (storedEntry !== ENTRY_FEE_BPS || storedExit !== EXIT_FEE_BPS || storedMgmt !== MGMT_FEE_BPS) {
      throw new Error(`fees mismatch ${storedEntry}/${storedExit}/${storedMgmt}`);
    }
    if (!Buffer.from(d.subarray(160, 192)).equals(metadataHash)) throw new Error("metadata_hash mismatch");

    const mint = await readMint(conn, shareMint);
    if (!mint) throw new Error("share mint missing");
    if (mint.supply !== GENESIS_SHARES) throw new Error(`share supply ${mint.supply} != ${GENESIS_SHARES}`);
    if (mint.decimals !== 6) throw new Error(`share decimals ${mint.decimals} != 6`);

    const creatorShareBal = await readTokenAmount(conn, deriveAta(creator, shareMint));
    if (creatorShareBal !== GENESIS_SHARES) {
      throw new Error(`creator share ATA ${creatorShareBal} != ${GENESIS_SHARES}`);
    }
    for (let i = 0; i < mints.length; i++) {
      const vaultAta = deriveAta(vaultAuthority, mints[i]);
      const bal = await readTokenAmount(conn, vaultAta);
      if (bal !== SEED_AMOUNTS[i]) throw new Error(`vault[${i}] ${bal} != seed ${SEED_AMOUNTS[i]}`);
      console.log(`  vault[${i}] ${CONSTITUENTS[i].symbol} ${mints[i].toBase58()} = ${fmtRaw(SEED_AMOUNTS[i])}`);
    }
    console.log(`  basket ${basket.toBase58()}`);
    console.log(`  share_mint ${shareMint.toBase58()} supply=${mint.supply} (genesis)`);
    console.log(`  creator share ATA = ${fmtRaw(GENESIS_SHARES)}`);
    console.log(`  last_fee_accrual_ts=${lastAccrual} (checkpoints at create time)`);

    const entry = {
      factory: factory.toBase58(),
      basket: basket.toBase58(),
      shareMint: shareMint.toBase58(),
      vaultAuthority: vaultAuthority.toBase58(),
      creator: creator.toBase58(),
      creatorShareAta: deriveAta(creator, shareMint).toBase58(),
      treasury: treasury.toBase58(),
      treasuryShareAta: deriveAta(treasury, shareMint).toBase58(),
      nonce: NONCE.toString(),
      numConstituents: CONSTITUENTS.length,
      constituents: mints.map((m) => m.toBase58()),
      constituentSymbols: CONSTITUENTS.map((c) => c.symbol),
      weightsBps: WEIGHTS,
      feesBps: { entry: ENTRY_FEE_BPS, exit: EXIT_FEE_BPS, mgmt: MGMT_FEE_BPS },
      seedAmounts: SEED_AMOUNTS.map((s) => s.toString()),
      metadataBlob: METADATA_BLOB,
      createTx: createSig,
    };
    // Per-basket registry: state.baskets[<nonce>] so downstream scripts can
    // target a specific basket (FOLIOX_E2E_BASKET=<nonce>). When the previous
    // state predates the registry, fold the old top-level basket in as its own
    // entry before the top-level keys are overwritten with the new basket.
    const prevBaskets: Record<string, unknown> = { ...(state.baskets ?? {}) };
    if (state.basket && prevBaskets[state.nonce ?? "0"] === undefined) {
      prevBaskets[String(state.nonce ?? "0")] = {
        factory: state.factory,
        basket: state.basket,
        shareMint: state.shareMint,
        vaultAuthority: state.vaultAuthority,
        creator: state.creator,
        creatorShareAta: state.creatorShareAta,
        treasury: state.treasury,
        treasuryShareAta: state.treasuryShareAta,
        nonce: state.nonce,
        numConstituents: state.numConstituents,
        constituents: state.constituents,
        constituentSymbols: state.constituentSymbols,
        weightsBps: state.weightsBps,
        feesBps: state.feesBps,
        seedAmounts: state.seedAmounts,
        metadataBlob: state.metadataBlob,
        createTx: state.createTx ?? "",
      };
    }
    saveState({
      ...entry,
      baskets: { ...prevBaskets, [NONCE.toString()]: entry },
    });
  });

  if (hasStepFailure()) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
