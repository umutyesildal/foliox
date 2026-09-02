/**
 * FolioX localnet E2E — step 2/4: factory + basket.
 *
 *   - init_factory(treasury, creator_split=9000) — factory caps are hardcoded
 *     on-chain at 300/100/300 (entry/exit/mgmt) and echoed in the output.
 *   - create_basket(nonce=0, 3 constituents 5000/3000/2000 bps, fees
 *     100/50/200 bps, metadata_hash = sha256(json blob), seed amounts
 *     500/300/200 raw-1e6) passing remaining_accounts per constituent in the
 *     factory's exact context order:
 *         [WhitelistedMint PDA, mint, creator_ata, vault_ata]
 *     (programs/basket_factory/src/lib.rs ACCOUNTS_PER_CONSTITUENT = 4).
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
 * treasury, fees, weights, seedAmounts.
 */

import { PublicKey, Transaction } from "@solana/web3.js";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import {
  deriveAta,
  deriveBasketPda,
  deriveFactoryConfig,
  deriveShareMint,
  deriveVaultAuthority,
  deriveWhitelistedMint,
  ensureSol,
  fmtRaw,
  ixCreateBasket,
  ixInitFactory,
  keypairFromFile,
  loadState,
  newConnection,
  payerKeypair,
  readMint,
  readTokenAmount,
  saveState,
  send,
  stateDir,
  step,
  hasStepFailure,
} from "./lib.ts";

const NONCE = 0n;
const CREATOR_FEE_SPLIT_BPS = 9000;
const ENTRY_FEE_BPS = 100;
const EXIT_FEE_BPS = 50;
const MGMT_FEE_BPS = 200;
const SEED_AMOUNTS = [500_000_000n, 300_000_000n, 200_000_000n]; // 500/300/200 tokens (weights 50/30/20)
const WEIGHTS = [5000, 3000, 2000];
const GENESIS_SHARES = 1_000_000n;

const METADATA_BLOB = JSON.stringify({
  name: "FolioX Demo Basket",
  symbol: "FDX",
  version: "localnet-e2e",
  constituents: [
    { symbol: "TSLAx", weight_bps: 5000 },
    { symbol: "NVDAx", weight_bps: 3000 },
    { symbol: "AAPLx", weight_bps: 2000 },
  ],
  note: "mock localnet basket — NOT an ETF, demo data only",
});

async function main() {
  const conn = newConnection();
  const payer = payerKeypair(); // factory authority + basket creator
  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`creator/payer: ${payer.publicKey.toBase58()}`);
  await ensureSol(conn, payer, 2, 10);

  const state = loadState();
  const mints: PublicKey[] = (state.mints || []).map((m: string) => new PublicKey(m));
  if (mints.length !== 3) throw new Error("run scripts/createWhitelist.ts first (3 mock mints expected)");

  // Treasury: payer by default, or an independent generated keypair
  // (FOLIOX_E2E_TREASURY=<keypair file>) so the 90/10 fee split is
  // separately observable. The treasury never needs to sign or hold SOL.
  const treasuryKp = process.env.FOLIOX_E2E_TREASURY
    ? keypairFromFile(process.env.FOLIOX_E2E_TREASURY)
    : null;
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
  const creator = payer.publicKey;
  const basket = deriveBasketPda(factory, creator, NONCE);
  const shareMint = deriveShareMint(basket);
  const vaultAuthority = deriveVaultAuthority(basket);
  const metadataHash = createHash("sha256").update(METADATA_BLOB).digest();

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
    `create_basket nonce=${NONCE} 3 xStocks 50/30/20, fees 100/50/200, seeds 500/300/200`,
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
      try {
        await send(conn, "create_basket", [createIx], [payer]);
      } catch (err) {
        // A failed tx has no on-chain effect, so re-simulating reproduces the
        // failure and surfaces the program logs (silent 3xxx codes otherwise).
        console.error(`  create_basket send failed: ${err}`);
        try {
          const sim = await conn.simulateTransaction(new Transaction().add(createIx), [payer]);
          console.error(`  simulation err: ${JSON.stringify(sim.value.err)}`);
          for (const line of sim.value.logs ?? []) console.error(`    ${line}`);
        } catch (simErr) {
          console.error(`  simulation itself failed: ${simErr}`);
        }
        throw err;
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
    if (numConstituents !== 3) throw new Error(`num_constituents ${numConstituents} != 3`);
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
    for (let i = 0; i < 3; i++) {
      const vaultAta = deriveAta(vaultAuthority, mints[i]);
      const bal = await readTokenAmount(conn, vaultAta);
      if (bal !== SEED_AMOUNTS[i]) throw new Error(`vault[${i}] ${bal} != seed ${SEED_AMOUNTS[i]}`);
      console.log(`  vault[${i}] ${mints[i].toBase58()} = ${fmtRaw(SEED_AMOUNTS[i])}`);
    }
    console.log(`  basket ${basket.toBase58()}`);
    console.log(`  share_mint ${shareMint.toBase58()} supply=${mint.supply} (genesis)`);
    console.log(`  creator share ATA = ${fmtRaw(GENESIS_SHARES)}`);
    console.log(`  last_fee_accrual_ts=${lastAccrual} (checkpoints at create time)`);

    saveState({
      factory: factory.toBase58(),
      basket: basket.toBase58(),
      shareMint: shareMint.toBase58(),
      vaultAuthority: vaultAuthority.toBase58(),
      creator: creator.toBase58(),
      creatorShareAta: deriveAta(creator, shareMint).toBase58(),
      treasury: treasury.toBase58(),
      treasuryShareAta: deriveAta(treasury, shareMint).toBase58(),
      nonce: NONCE.toString(),
      weightsBps: WEIGHTS,
      feesBps: { entry: ENTRY_FEE_BPS, exit: EXIT_FEE_BPS, mgmt: MGMT_FEE_BPS },
      seedAmounts: SEED_AMOUNTS.map((s) => s.toString()),
      metadataBlob: METADATA_BLOB,
    });
  });

  if (hasStepFailure()) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
