/**
 * Headless BUY-FLOW proof: the UI's exact mint/redeem transaction builders on
 * live devnet, after the v0+ALT + compute-budget fix.
 *
 * What it proves (task gate):
 *   1. 6-constituent basket (nonce 1, CZCH…XYCo): the UI-built mint_in_kind and
 *      redeem_in_kind transactions compile through the wallet-signed lookup
 *      table (ensureMintRedeemAlt), fit the 1232B packet limit (exact size
 *      reported), carry the 500k compute-unit-limit instruction FIRST, and
 *      simulate clean (err = null, unitsConsumed reported). One REAL send each
 *      confirms on-chain.
 *   2. 3-constituent basket (nonce 0): no regression — mintRedeemNeedsAlt(3) is
 *      false, the LEGACY wire (with the compute-budget pair) still fits under
 *      1232B, and both instructions simulate clean on the exact legacy path the
 *      flow hook uses.
 *
 * The payer keypair stands in for the connected wallet everywhere (it signs the
 * lookup-table create/extend transactions through the app's own
 * ensureMintRedeemAlt, then signs the built transactions like Phantom would).
 *
 * Run (from the repo root — via npm so the source path never hits the shell):
 *   FOLIOX_E2E_RPC_URL=https://api.devnet.solana.com \
 *   FOLIOX_E2E_PAYER=$PWD/scripts/.e2e-devnet/payer.json \
 *   FOLIOX_E2E_STATE_DIR=$PWD/scripts/.e2e-devnet \
 *   npm run proof:buyflow
 */

import {
  ComputeBudgetProgram,
  Keypair,
  Transaction,
  TransactionInstruction,
  PublicKey,
  type Connection,
  type VersionedTransaction,
} from "@solana/web3.js";

import {
  buildMintInKind,
  buildMintInKindTransaction,
  buildRedeemInKind,
  buildRedeemInKindTransaction,
  computeBudgetInstructions,
  deriveAta as deriveAtaApp,
  deriveVaultAuthority as deriveVaultAuthorityApp,
  ensureMintRedeemAlt,
  estimateMintRedeemTxSize,
  mintRedeemNeedsAlt,
  UI_PRIORITY_PRICE_MICROLAMPORTS,
  type BasketCoreKeys,
  type BuiltMintRedeemTx,
} from "../app/lib/transactions.ts";
import {
  deriveAltAddress,
  ensureSol,
  legacyWireSize,
  loadState,
  newConnection,
  PACKET_LIMIT,
  payerKeypair,
  readMint,
  readTokenAmount,
  saveState,
  selectBasket,
  sleep,
  step,
  hasStepFailure,
} from "./lib.ts";

interface BasketFixture {
  key: string;
  basket: PublicKey;
  core: BasketCoreKeys;
  constituents: PublicKey[];
  entryBps: number;
  exitBps: number;
  mgmtBps: bigint;
}

async function loadFixture(nonce: string, expectedConstituents: number): Promise<BasketFixture> {
  process.env.FOLIOX_E2E_BASKET = nonce;
  const { key, entry } = selectBasket(loadState());
  if (entry.nonce !== nonce) {
    throw new Error(`state.baskets[${key}] is nonce ${entry.nonce}, expected ${nonce}`);
  }
  const constituents = (entry.constituents ?? []).map((m) => new PublicKey(m));
  if (constituents.length !== expectedConstituents) {
    throw new Error(
      `state.baskets[${key}] has ${constituents.length} constituents, expected ${expectedConstituents}`,
    );
  }
  for (const k of ["basket", "shareMint", "factory", "creator", "treasury", "feesBps"] as const) {
    if (!entry[k]) throw new Error(`state.baskets[${key}].${k} missing`);
  }
  const basket = new PublicKey(entry.basket);
  const user = payerKeypair().publicKey;
  return {
    key,
    basket,
    constituents,
    core: {
      basket,
      factory: new PublicKey(entry.factory!),
      creator: new PublicKey(entry.creator!),
      treasury: new PublicKey(entry.treasury!),
      shareMint: new PublicKey(entry.shareMint!),
      constituents: constituents.map((m) => m.toBase58()),
      user,
    },
    entryBps: entry.feesBps!.entry,
    exitBps: entry.feesBps!.exit,
    mgmtBps: BigInt(entry.feesBps!.mgmt),
  };
}

async function readVaults(conn: Connection, fixture: BasketFixture): Promise<bigint[]> {
  const vaultAuthority = deriveVaultAuthorityApp(fixture.basket)[0];
  const out: bigint[] = [];
  for (const m of fixture.constituents) {
    const v = await readTokenAmount(conn, deriveAtaApp(vaultAuthority, m));
    if (v === null) throw new Error(`vault ATA missing for ${m.toBase58()}`);
    out.push(v);
  }
  return out;
}

async function readSupply(conn: Connection, fixture: BasketFixture): Promise<bigint> {
  const m = await readMint(conn, fixture.core.shareMint);
  if (!m) throw new Error("share mint missing");
  return m.supply;
}

/** The compiled transaction's first instruction must be the 500k CU limit. */
function assertComputeBudget(built: BuiltMintRedeemTx): { units: number; price: number | null } {
  const msg = built.transaction.message;
  const first = msg.compiledInstructions[0];
  if (!first) throw new Error("compiled transaction has no instructions");
  const firstProgram = msg.staticAccountKeys[first.programIdIndex];
  if (!firstProgram.equals(ComputeBudgetProgram.programId)) {
    throw new Error(
      `first instruction program is ${firstProgram.toBase58()} — compute budget not first`,
    );
  }
  const data = Buffer.from(first.data);
  // ComputeBudget instructions encode a u8 tag, then the value: SetComputeUnitLimit = [2][u32 units].
  if (data[0] !== 2) throw new Error(`first compute-budget tag ${data[0]} != 2 (SetComputeUnitLimit)`);
  const units = data.readUInt32LE(1);
  if (units !== 500_000) throw new Error(`compute unit limit ${units} != 500000`);
  let price: number | null = null;
  const second = msg.compiledInstructions[1];
  if (second) {
    const p = msg.staticAccountKeys[second.programIdIndex];
    const d = Buffer.from(second.data);
    // SetComputeUnitPrice = [3][u64 micro-lamports].
    if (p.equals(ComputeBudgetProgram.programId) && d[0] === 3) {
      price = Number(d.readBigUInt64LE(1));
    }
  }
  return { units, price };
}

async function simulateBuilt(conn: Connection, built: BuiltMintRedeemTx) {
  const result = await conn.simulateTransaction(built.transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  return result.value;
}

/** Sign with the payer (Phantom's stand-in), send, confirm. */
async function signSendConfirm(conn: Connection, payer: Keypair, built: BuiltMintRedeemTx): Promise<string> {
  built.transaction.sign([payer]);
  const signature = await conn.sendTransaction(built.transaction, { skipPreflight: false });
  await conn.confirmTransaction(
    {
      signature,
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    },
    "confirmed",
  );
  return signature;
}

async function simulateLegacy(
  conn: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
  tx.add(...ixs);
  const res = await conn.simulateTransaction(tx);
  return res.value;
}

async function main() {
  const conn = newConnection();
  const payer = payerKeypair();
  const payerKey = payer.publicKey;
  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`wallet stand-in (payer): ${payerKey.toBase58()}`);
  await ensureSol(conn, payer, 0.5, 0);

  // ---- shared wallet-signed lookup table (app ensureMintRedeemAlt) ----
  // Reuse the table from a previous run when it still exists, so repeat proofs
  // do not pay rent for a fresh table every time.
  const prior = (loadState().mintRedeemAlt ?? {}) as { authority?: string; slot?: number };
  let recentSlot: number;
  if (
    prior.authority === payerKey.toBase58() &&
    typeof prior.slot === "number" &&
    (await conn.getAccountInfo(deriveAltAddress(payerKey, prior.slot)))
  ) {
    recentSlot = prior.slot;
    console.log(`reusing ALT slot ${recentSlot} from a previous proof run`);
  } else {
    recentSlot = await conn.getSlot("finalized");
  }
  const walletSign = async (tx: VersionedTransaction): Promise<string> => {
    tx.sign([payer]);
    return conn.sendTransaction(tx, { skipPreflight: false });
  };

  // ================= nonce 1 — 6 constituents (the broken buy flow) =================
  const six = await loadFixture("1", 6);
  if (six.basket.toBase58() !== "CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo") {
    throw new Error(`nonce-1 basket moved: ${six.basket.toBase58()}`);
  }
  if (!mintRedeemNeedsAlt(6)) throw new Error("mintRedeemNeedsAlt(6) must be true");
  if (mintRedeemNeedsAlt(3)) throw new Error("mintRedeemNeedsAlt(3) must be false");
  console.log(
    `estimates (legacy wire, incl. compute budget): ` +
      [3, 4, 5, 6].map((n) => `n=${n}→${estimateMintRedeemTxSize(n)}B`).join(", "),
  );

  let altAddress: PublicKey | null = null;
  await step("nonce-1: ensureMintRedeemAlt (wallet-signed by the payer)", async () => {
    const handle = await ensureMintRedeemAlt({
      connection: conn,
      keys: six.core,
      sendTransaction: walletSign,
      recentSlot,
    });
    altAddress = handle.lookupTableAddress;
    saveState({
      mintRedeemAlt: { authority: payerKey.toBase58(), slot: recentSlot, address: altAddress.toBase58() },
    });
    console.log(
      `  ALT ${altAddress.toBase58()} (created=${handle.created}, extended=${handle.extended})`,
    );
  });

  interface ProofRecord {
    basket: string;
    alt?: string;
    mint?: Record<string, unknown>;
    redeem?: Record<string, unknown>;
    legacyNonce0?: Record<string, unknown>;
  }
  const record: ProofRecord = { basket: six.basket.toBase58() };

  await step("nonce-1 mint_in_kind: UI builder → size ≤ 1232, CU ix first, simulate, REAL send", async () => {
    if (!altAddress) throw new Error("ALT missing");
    const vaults = await readVaults(conn, six);
    const supply = await readSupply(conn, six);
    const deposits = vaults.map(() => 0n);
    // Largest affordable proportional deposit: pct% of the vault, pct capped by
    // the payer's smallest balance headroom (≤ 2% of the vault).
    let pct = 2n;
    for (let i = 0; i < six.constituents.length; i++) {
      const bal = (await readTokenAmount(conn, deriveAtaApp(payerKey, six.constituents[i]))) ?? 0n;
      const cap = (bal * 100n) / vaults[i];
      if (cap < pct) pct = cap;
    }
    if (pct === 0n) throw new Error("payer cannot afford 1% of the vault — run scripts/faucet.ts");
    for (let i = 0; i < vaults.length; i++) deposits[i] = (vaults[i] * pct) / 100n;
    console.log(`  supply=${supply} deposits=${pct}% of vault = [${deposits.join(", ")}]`);

    // BEFORE (legacy wire with the compute budget) — the number the old code hit.
    const legacyIx = buildMintInKind({ keys: six.core, amounts: deposits, vaultBalances: vaults });
    const legacySize = legacyWireSize(legacyIx.instructions, payerKey, {
      computeUnitPrice: UI_PRIORITY_PRICE_MICROLAMPORTS,
    });

    const built = await buildMintInKindTransaction({
      connection: conn,
      keys: six.core,
      amounts: deposits,
      vaultBalances: vaults,
      lookupTableAddresses: [altAddress],
    });
    if (built.sizeBytes > PACKET_LIMIT) throw new Error(`mint wire ${built.sizeBytes}B > ${PACKET_LIMIT}B`);
    if (!built.usedLookupTable) throw new Error("n=6 mint must compile through the ALT");
    const cu = assertComputeBudget(built);
    console.log(
      `  wire: legacy ${legacySize}B (> ${PACKET_LIMIT}B) → v0+ALT ${built.sizeBytes}B | CU limit ${cu.units} first, price ${cu.price}`,
    );

    const sim = await simulateBuilt(conn, built);
    if (sim.err) throw new Error(`simulation reverted: ${JSON.stringify(sim.err)}\n${(sim.logs ?? []).join("\n")}`);
    console.log(`  simulate: err=null, unitsConsumed=${sim.unitsConsumed}`);

    const shareAta = deriveAtaApp(payerKey, six.core.shareMint);
    const sharesBefore = (await readTokenAmount(conn, shareAta)) ?? 0n;
    const sig = await signSendConfirm(conn, payer, built);
    await sleep(2500); // pace the shared public RPC
    const sharesAfter = (await readTokenAmount(conn, shareAta)) ?? 0n;
    if (sharesAfter <= sharesBefore) throw new Error("share balance did not increase — mint did not land");
    console.log(`  CONFIRMED ${sig} (shares ${sharesBefore} → ${sharesAfter})`);
    record.mint = {
      legacySize,
      v0Size: built.sizeBytes,
      cuUnits: cu.units,
      unitsConsumed: sim.unitsConsumed,
      signature: sig,
    };
  });

  await step("nonce-1 redeem_in_kind: UI builder → size ≤ 1232, CU ix first, simulate, REAL send", async () => {
    if (!altAddress) throw new Error("ALT missing");
    const vaults = await readVaults(conn, six);
    const supply = await readSupply(conn, six);
    const shareAta = deriveAtaApp(payerKey, six.core.shareMint);
    const shareBal = (await readTokenAmount(conn, shareAta)) ?? 0n;
    const shares = shareBal / 2n;
    if (shares === 0n) throw new Error("no shares to redeem — the mint step should have produced some");
    console.log(`  supply=${supply} burning ${shares} of ${shareBal} shares`);

    const legacyIx = buildRedeemInKind({ keys: six.core, sharesToBurn: shares, vaultBalances: vaults });
    const legacySize = legacyWireSize(legacyIx.instructions, payerKey, {
      computeUnitPrice: UI_PRIORITY_PRICE_MICROLAMPORTS,
    });

    const built = await buildRedeemInKindTransaction({
      connection: conn,
      keys: six.core,
      sharesToBurn: shares,
      vaultBalances: vaults,
      lookupTableAddresses: [altAddress],
    });
    if (built.sizeBytes > PACKET_LIMIT) throw new Error(`redeem wire ${built.sizeBytes}B > ${PACKET_LIMIT}B`);
    const cu = assertComputeBudget(built);
    console.log(
      `  wire: legacy ${legacySize}B → v0+ALT ${built.sizeBytes}B | CU limit ${cu.units} first, price ${cu.price}`,
    );

    const sim = await simulateBuilt(conn, built);
    if (sim.err) throw new Error(`simulation reverted: ${JSON.stringify(sim.err)}\n${(sim.logs ?? []).join("\n")}`);
    console.log(`  simulate: err=null, unitsConsumed=${sim.unitsConsumed}`);

    const sig = await signSendConfirm(conn, payer, built);
    console.log(`  CONFIRMED ${sig}`);
    await sleep(2500);
    // The exit fee is NOT burned — it is split 90/10 creator/treasury as
    // shares, and the accrual that runs first adds a bounded extra mint to the
    // creator (the payer IS the nonce-1 creator). Same model as
    // scripts/verifyClientBuilders.ts.
    const exitFee = (shares * BigInt(six.exitBps)) / 10_000n;
    const creatorLeg = (exitFee * 9000n) / 10_000n;
    const bound = (supply * six.mgmtBps * 600n) / (10_000n * 31_536_000n);
    const shareAfter = (await readTokenAmount(conn, shareAta)) ?? 0n;
    const floor_ = shareBal - shares + creatorLeg;
    if (shareAfter < floor_ || shareAfter > floor_ + bound) {
      throw new Error(
        `share balance after redeem ${shareAfter} outside ${floor_} + accrual bound ${bound}`,
      );
    }
    console.log(`  shares ${shareBal} → ${shareAfter} (= -${shares} burned + ${shareAfter - floor_} fee legs within bound ${bound})`);
    record.redeem = {
      legacySize,
      v0Size: built.sizeBytes,
      cuUnits: cu.units,
      unitsConsumed: sim.unitsConsumed,
      signature: sig,
    };
  });

  // ================= nonce 0 — 3 constituents (legacy regression) =================
  const three = await loadFixture("0", 3);
  record.legacyNonce0 = { basket: three.basket.toBase58() };

  await step("nonce-0 (3c): legacy wire still fits + mint/redeem simulate clean (no regression)", async () => {
    if (mintRedeemNeedsAlt(3)) throw new Error("n=3 must stay on the legacy path");
    const vaults = await readVaults(conn, three);
    const supply = await readSupply(conn, three);
    const budget = { computeUnitPrice: UI_PRIORITY_PRICE_MICROLAMPORTS };

    // mint sim (proportional 1% of the vault)
    let pct = 1n;
    for (let i = 0; i < three.constituents.length; i++) {
      const bal = (await readTokenAmount(conn, deriveAtaApp(payerKey, three.constituents[i]))) ?? 0n;
      const cap = (bal * 100n) / vaults[i];
      if (cap < pct) pct = cap;
    }
    const deposits = vaults.map((v) => (v * pct) / 100n);
    if (pct === 0n || deposits.some((d) => d === 0n)) {
      throw new Error("payer cannot fund a 1% nonce-0 deposit — run scripts/faucet.ts");
    }
    const mintIx = buildMintInKind({ keys: three.core, amounts: deposits, vaultBalances: vaults });
    const mintLegacy = legacyWireSize(mintIx.instructions, payerKey, budget);
    if (mintLegacy > PACKET_LIMIT) throw new Error(`nonce-0 mint legacy ${mintLegacy}B > ${PACKET_LIMIT}B`);
    const mintSim = await simulateLegacy(conn, payerKey, [
      ...computeBudgetInstructions(),
      ...mintIx.instructions,
    ]);
    if (mintSim.err) {
      throw new Error(`nonce-0 mint simulation reverted: ${JSON.stringify(mintSim.err)}\n${(mintSim.logs ?? []).join("\n")}`);
    }
    console.log(
      `  mint: legacy ${mintLegacy}B ≤ ${PACKET_LIMIT}B, simulate err=null, unitsConsumed=${mintSim.unitsConsumed}`,
    );

    // redeem sim — ensure the payer actually holds nonce-0 shares (a tiny real
    // legacy mint first if an earlier run spent them all).
    const shareAta = deriveAtaApp(payerKey, three.core.shareMint);
    let shareBal = (await readTokenAmount(conn, shareAta)) ?? 0n;
    if (shareBal === 0n) {
      console.log("  payer holds no nonce-0 shares — one real legacy mint to enable the redeem sim");
      const tiny = deposits.map((d) => d / 4n);
      const builtTiny = await buildMintInKindTransaction({
        connection: conn,
        keys: three.core,
        amounts: tiny,
        vaultBalances: vaults,
      });
      const sig = await signSendConfirm(conn, payer, builtTiny);
      console.log(`  top-up mint CONFIRMED ${sig}`);
      await sleep(2500);
      shareBal = (await readTokenAmount(conn, shareAta)) ?? 0n;
      if (shareBal === 0n) throw new Error("top-up mint produced no shares");
      // vaults moved — re-read for the redeem sim
      const freshVaults = await readVaults(conn, three);
      vaults.length = 0;
      vaults.push(...freshVaults);
    }
    const shares = shareBal / 4n;
    const redeemIx = buildRedeemInKind({ keys: three.core, sharesToBurn: shares, vaultBalances: vaults });
    const redeemLegacy = legacyWireSize(redeemIx.instructions, payerKey, budget);
    if (redeemLegacy > PACKET_LIMIT) throw new Error(`nonce-0 redeem legacy ${redeemLegacy}B > ${PACKET_LIMIT}B`);
    const redeemSim = await simulateLegacy(conn, payerKey, [
      ...computeBudgetInstructions(),
      ...redeemIx.instructions,
    ]);
    if (redeemSim.err) {
      throw new Error(`nonce-0 redeem simulation reverted: ${JSON.stringify(redeemSim.err)}\n${(redeemSim.logs ?? []).join("\n")}`);
    }
    console.log(
      `  redeem: legacy ${redeemLegacy}B ≤ ${PACKET_LIMIT}B, simulate err=null, unitsConsumed=${redeemSim.unitsConsumed}`,
    );
    record.legacyNonce0 = {
      basket: three.basket.toBase58(),
      mintLegacySize: mintLegacy,
      mintUnitsConsumed: mintSim.unitsConsumed,
      redeemLegacySize: redeemLegacy,
      redeemUnitsConsumed: redeemSim.unitsConsumed,
    };
  });

  saveState({ clientBuyFlowProof: { ...(loadState().clientBuyFlowProof ?? {}), ...record } });

  if (hasStepFailure()) process.exit(1);
  console.log("\nBUY-FLOW PROOF: PASS (6c mint+redeem v0+ALT simulated & confirmed; 3c legacy intact)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
