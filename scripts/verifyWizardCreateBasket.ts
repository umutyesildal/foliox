/**
 * PROOF GATE for the create wizard's client builders (bugs 1 + 2).
 *
 * Simulates the EXACT transaction the create wizard builds — through the app's
 * own exported `ensureCreateBasketAlt` + `buildCreateBasketTransaction`
 * (NOT the scripts' ixCreateBasket path) — against LIVE devnet, for:
 *   1. a 6-constituent basket (v0 + Address Lookup Table path, nonce 2), and
 *   2. a 2-constituent basket (legacy-shaped path: v0 message with NO lookup
 *      tables and no compute-budget instruction — byte-compat semantics).
 *
 * The wallet role is played by the e2e payer keypair exactly like
 * scripts/verifyClientBuilders.ts: it signs the ALT management transactions
 * (create + extend) the way Phantom would, and the consumer transaction is
 * simulated via simulateTransaction — success (err === null) is the gate.
 *
 * Assertions include the bug-1 proof: the app's `associatedTokenAddress`
 * (fixed to canonical seeds [owner, token_program, mint] under the ATA
 * program) must equal the scripts' proven deriveAta AND resolve to REAL
 * on-chain token accounts holding the mock balances — the wrong pre-fix
 * derivation pointed at nonexistent accounts, which is what made
 * create_basket fail with AnchorError 6016 (InvalidCreatorAta).
 *
 * FOLIOX_WIZARD_DEPLOY=1 additionally sends the 6-constituent transaction for
 * real (one basket; fee/rent ≈ 0.03 SOL) and verifies on-chain state. The
 * default (unset) runs simulations only.
 *
 * Run (from the repo root — the --tsconfig flag teaches tsx the "@/lib" alias):
 *
 *   FOLIOX_E2E_RPC_URL=https://api.devnet.solana.com \
 *   FOLIOX_E2E_PAYER=$PWD/scripts/.e2e-devnet/payer.json \
 *   FOLIOX_E2E_STATE_DIR=$PWD/scripts/.e2e-devnet \
 *   npx tsx --tsconfig app/tsconfig.json scripts/verifyWizardCreateBasket.ts
 */

import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";

import {
  deriveCreateBasketPdas,
  associatedTokenAddress,
  validateCreateBasketArgs,
  type CreateBasketArgs,
} from "../app/lib/create-basket.ts";
import {
  buildCreateBasketTransaction,
  createBasketNeedsAlt,
  ensureCreateBasketAlt,
  type WalletSendTransaction,
} from "../app/lib/transactions.ts";
import {
  deriveAta as deriveAtaScripts,
  deriveBasketPda as deriveBasketPdaScripts,
  deriveFactoryConfig,
  deriveShareMint as deriveShareMintScripts,
  deriveVaultAuthority as deriveVaultAuthorityScripts,
  deriveWhitelistedMint as deriveWhitelistedMintScripts,
  ensureSol,
  fmtRaw,
  loadState,
  newConnection,
  payerKeypair,
  readMint,
  readTokenAmount,
  saveState,
  step,
  hasStepFailure,
} from "./lib.ts";

const ENTRY_FEE_BPS = 100;
const EXIT_FEE_BPS = 50;
const MGMT_FEE_BPS = 200;
const GENESIS_SHARES = 1_000_000n;

const SIX: { symbol: string; weightBps: number }[] = [
  { symbol: "TSLAx", weightBps: 2500 },
  { symbol: "NVDAx", weightBps: 2000 },
  { symbol: "AAPLx", weightBps: 1500 },
  { symbol: "MSFTx", weightBps: 1500 },
  { symbol: "AMZNx", weightBps: 1250 },
  { symbol: "GOOGLx", weightBps: 1250 },
];
const TWO: { symbol: string; weightBps: number }[] = [
  { symbol: "NVDAx", weightBps: 6000 },
  { symbol: "AAPLx", weightBps: 4000 },
];

function mintArgs(
  bySymbol: Map<string, PublicKey>,
  spec: { symbol: string; weightBps: number }[],
  nonce: number,
  creator: PublicKey,
): CreateBasketArgs {
  const metadataBlob = JSON.stringify({
    name: "FolioX Wizard Proof Basket",
    symbol: "FWP",
    version: "wizard-devnet-proof",
    constituents: spec.map((c) => ({ symbol: c.symbol, weight_bps: c.weightBps })),
    note: "wizard-built create_basket simulation proof — NOT an ETF, demo data only",
  });
  const metadataHash = new Uint8Array(
    createHash("sha256").update(metadataBlob).digest(),
  );
  return {
    nonce,
    constituents: spec.map((c) => bySymbol.get(c.symbol)!.toBase58()),
    weightsBps: spec.map((c) => c.weightBps),
    entryFeeBps: ENTRY_FEE_BPS,
    exitFeeBps: EXIT_FEE_BPS,
    managementFeeBps: MGMT_FEE_BPS,
    metadataHash,
    seedAmounts: spec.map((c) => BigInt(c.weightBps) * 100_000n),
  };
}

async function main() {
  const conn = newConnection();
  const payer = payerKeypair();
  const creator = payer.publicKey.toBase58();
  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`creator/wallet (payer keypair as Phantom): ${creator}`);
  await ensureSol(conn, payer, 0.5, 0);

  const state = loadState();
  const bySymbol = new Map<string, PublicKey>();
  for (const [symbol, mint] of Object.entries<string>(
    (state.mintAddressBySymbol ?? {}) as Record<string, string>,
  )) {
    bySymbol.set(symbol, new PublicKey(mint));
  }
  if (bySymbol.size === 0) throw new Error("state.json has no mintAddressBySymbol — run the devnet e2e first");
  const decimals = Number(state.mintDecimals ?? 6);

  // Nonce: the factory's on-chain basket_count (2 after nonce 0 + 1) — the
  // value only matters for PDA freshness; the sim creates no state.
  const factoryInfo = await conn.getAccountInfo(deriveFactoryConfig());
  if (!factoryInfo) throw new Error("factory not found on devnet — wrong cluster/state?");
  const basketCount = factoryInfo.data.readBigUInt64LE(80);
  const NONCE = Number(process.env.FOLIOX_E2E_BASKET_NONCE ?? basketCount.toString());
  console.log(`factory basket_count: ${basketCount} → nonce ${NONCE}`);

  // Wallet stand-in: signs versioned transactions with the payer keypair the
  // way the wallet adapter would, sends raw, returns the signature. Spaced
  // like scripts/lib.ts txPace — the public devnet RPC rate-limits bursts.
  const sendLikeWallet: WalletSendTransaction = async (transaction, connection) => {
    transaction.sign([payer]);
    await new Promise((r) => setTimeout(r, 2500 + Math.floor(Math.random() * 1500)));
    return connection.sendTransaction(transaction, { skipPreflight: false });
  };

  const simulateLikeWizard = async (label: string, args: CreateBasketArgs, altAddress: PublicKey | null) => {
    const built = await buildCreateBasketTransaction({
      connection: conn,
      creator,
      args,
      lookupTableAddresses: altAddress ? [altAddress] : [],
    });
    console.log(
      `  ${label}: usedLookupTable=${built.usedLookupTable} wire=${built.sizeBytes}B (limit 1232)`,
    );
    const result = await conn.simulateTransaction(built.transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });
    return { built, result };
  };

  // ---------- step 1: bug-1 proof — app ATA derivation is the canonical one ----------
  await step("app associatedTokenAddress == canonical ATA (fixed derivation, real accounts)", async () => {
    for (const [symbol, mint] of bySymbol) {
      const app = associatedTokenAddress(payer.publicKey, mint);
      const scripts = deriveAtaScripts(payer.publicKey, mint);
      if (!app.equals(scripts)) {
        throw new Error(`ATA mismatch for ${symbol}: ${app.toBase58()} != ${scripts.toBase58()}`);
      }
      const bal = await readTokenAmount(conn, app);
      if (bal === null) {
        throw new Error(`payer ATA for ${symbol} (${app.toBase58()}) does not exist on devnet`);
      }
      console.log(`  ${symbol} ATA ${app.toBase58()} = ${fmtRaw(bal, decimals)}`);
    }
    console.log("  PASS: seeds [owner, token_program, mint] under the ATA program — matches scripts deriveAta and on-chain accounts");
  });

  // ---------- step 2: bug-2/3 proof — wizard-built 6-constituent v0+ALT tx simulates PASS ----------
  const sixArgs = mintArgs(bySymbol, SIX, NONCE, payer.publicKey);
  let sixAltAddress: PublicKey | null = null;
  await step("wizard 6-constituent create_basket (v0+ALT) simulateTransaction → success", async () => {
    const errors = validateCreateBasketArgs(sixArgs);
    if (errors.length > 0) throw new Error(`invalid args: ${errors.join(" ")}`);
    if (!createBasketNeedsAlt(6)) throw new Error("expected the 6-constituent path to need an ALT");

    // PDA cross-check against the scripts' derivations (the programs are
    // immutable — both sides must agree byte-for-byte).
    const pda = deriveCreateBasketPdas(creator, sixArgs);
    const creatorKey = new PublicKey(creator);
    const basketScripts = deriveBasketPdaScripts(deriveFactoryConfig(), creatorKey, BigInt(NONCE));
    if (!pda.basket.equals(basketScripts)) throw new Error("basket PDA mismatch vs scripts");
    if (!pda.shareMint.equals(deriveShareMintScripts(basketScripts))) throw new Error("share mint PDA mismatch vs scripts");
    if (!pda.vaultAuthority.equals(deriveVaultAuthorityScripts(basketScripts))) throw new Error("vault authority mismatch vs scripts");
    for (const mint of sixArgs.constituents) {
      if (!pda.whitelistedMints[sixArgs.constituents.indexOf(mint)].equals(
          deriveWhitelistedMintScripts(new PublicKey(mint)))) {
        throw new Error("whitelist PDA mismatch vs scripts");
      }
    }

    // Full wizard flow: the wallet signs the ALT create/extend, then the
    // builder compiles the consumer tx through the on-chain table. Reuse a
    // previously created table when it still exists on-chain (each table
    // costs rent; proofs should be re-runnable without burning SOL).
    const prev = (loadState().wizardCreateProof ?? {}).sixConstituent as
      | { alt?: string; altSlot?: number }
      | undefined;
    const reusePrev =
      prev?.alt && prev.altSlot && (await conn.getAccountInfo(new PublicKey(prev.alt)));
    const altSlot = reusePrev ? prev!.altSlot! : await conn.getSlot("finalized");
    if (reusePrev) console.log(`  reusing ALT ${prev!.alt} (slot ${altSlot})`);
    const alt = await ensureCreateBasketAlt({
      connection: conn,
      creator,
      args: sixArgs,
      sendTransaction: sendLikeWallet,
      recentSlot: altSlot,
      onAwaitingWallet: (awaiting) => {
        if (awaiting) console.log("  [wallet] signing ALT management transaction…");
      },
    });
    sixAltAddress = alt.lookupTableAddress;
    console.log(
      `  ALT ${alt.lookupTableAddress.toBase58()} created=${alt.created} extended=${alt.extended}`,
    );

    const { built, result } = await simulateLikeWizard("6-constituent", sixArgs, sixAltAddress);
    if (result.value.err) {
      console.error(`  simulation err: ${JSON.stringify(result.value.err)}`);
      for (const line of result.value.logs ?? []) console.error(`    ${line}`);
      throw new Error("6-constituent wizard transaction FAILED simulation");
    }
    console.log(`  unitsConsumed: ${result.value.unitsConsumed}`);
    console.log(`  logs (last 12 of ${result.value.logs?.length ?? 0}):`);
    for (const line of (result.value.logs ?? []).slice(-12)) console.log(`    ${line}`);
    saveState({
      wizardCreateProof: {
        ...(loadState().wizardCreateProof ?? {}),
        sixConstituent: {
          simulatedAt: new Date().toISOString(),
          nonce: String(NONCE),
          basket: pda.basket.toBase58(),
          shareMint: pda.shareMint.toBase58(),
          alt: alt.lookupTableAddress.toBase58(),
          altSlot,
          wireBytes: built.sizeBytes,
          unitsConsumed: result.value.unitsConsumed ?? null,
          err: null,
        },
      },
    });
  });

  // ---------- step 3: legacy-shaped 2-constituent path stays legacy + passes ----------
  await step("wizard 2-constituent create_basket (legacy path, no ALT) simulateTransaction → success", async () => {
    const args = mintArgs(bySymbol, TWO, NONCE, payer.publicKey);
    if (createBasketNeedsAlt(2)) throw new Error("2-constituent path must not need an ALT");
    const { built, result } = await simulateLikeWizard("2-constituent", args, null);
    if (built.usedLookupTable) throw new Error("2-constituent tx unexpectedly used a lookup table");
    // MessageV0 exposes compiledInstructions (index-referenced) — a compiled
    // v0 message never carries the legacy `instructions` property. Since the
    // buy/redeem v0+ALT wave, EVERY create tx (legacy-shaped included) carries
    // the compute-budget pair first: [setComputeUnitLimit, setComputeUnitPrice,
    // create_basket] — 3 instructions, no lookup tables on this path.
    const compiled = built.transaction.message as { compiledInstructions?: unknown[]; addressTableLookups?: unknown[] };
    if ((compiled.compiledInstructions ?? []).length !== 3) {
      throw new Error(
        `legacy path must carry the compute-budget pair + create_basket (3 instructions), got ${compiled.compiledInstructions?.length}`,
      );
    }
    if ((compiled.addressTableLookups ?? []).length !== 0) {
      throw new Error("legacy path must carry no address table lookups");
    }
    if (result.value.err) {
      console.error(`  simulation err: ${JSON.stringify(result.value.err)}`);
      for (const line of result.value.logs ?? []) console.error(`    ${line}`);
      throw new Error("2-constituent wizard transaction FAILED simulation");
    }
    console.log(`  unitsConsumed: ${result.value.unitsConsumed}`);
    console.log(`  logs (last 6):`);
    for (const line of (result.value.logs ?? []).slice(-6)) console.log(`    ${line}`);
  });

  // ---------- optional: one REAL deploy through the wizard path ----------
  if (process.env.FOLIOX_WIZARD_DEPLOY === "1") {
    await step("REAL deploy: wizard-built 6-constituent create_basket signed + sent to devnet", async () => {
      const balances = await Promise.all(
        sixArgs.constituents.map((mint) =>
          readTokenAmount(conn, associatedTokenAddress(payer.publicKey, new PublicKey(mint))),
        ),
      );
      sixArgs.constituents.forEach((mint, i) => {
        if ((balances[i] ?? 0n) < sixArgs.seedAmounts[i]) {
          throw new Error(`seed shortfall on ${mint}: ${balances[i]} < ${sixArgs.seedAmounts[i]}`);
        }
      });

      const built = await buildCreateBasketTransaction({
        connection: conn,
        creator,
        args: sixArgs,
        lookupTableAddresses: sixAltAddress ? [sixAltAddress] : [],
      });
      built.transaction.sign([payer]);
      const signature = await conn.sendTransaction(built.transaction, { skipPreflight: false });
      console.log(`  tx sent: ${signature}`);
      await conn.confirmTransaction(
        { signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight },
        "confirmed",
      );

      // On-chain verification (same layout reads as scripts/createBasket.ts).
      const pda = deriveCreateBasketPdas(creator, sixArgs);
      const info = await conn.getAccountInfo(pda.basket);
      if (!info) throw new Error("basket account missing after deploy");
      if (!new PublicKey(info.data.subarray(104, 136)).equals(pda.shareMint)) {
        throw new Error("basket.share_mint mismatch");
      }
      if (info.data[192] !== sixArgs.constituents.length) throw new Error("num_constituents mismatch");
      const mint = await readMint(conn, pda.shareMint);
      if (mint?.supply !== GENESIS_SHARES) throw new Error(`share supply ${mint?.supply} != ${GENESIS_SHARES}`);
      const creatorShareBal = (await readTokenAmount(conn, pda.creatorShareAta)) ?? 0n;
      if (creatorShareBal !== GENESIS_SHARES) throw new Error(`creator share ATA ${creatorShareBal} != ${GENESIS_SHARES}`);
      for (let i = 0; i < sixArgs.constituents.length; i++) {
        const vaultBal =
          (await readTokenAmount(conn, pda.vaultAtas[i])) ?? 0n;
        if (vaultBal !== sixArgs.seedAmounts[i]) {
          throw new Error(`vault[${i}] ${vaultBal} != seed ${sixArgs.seedAmounts[i]}`);
        }
      }
      console.log(`  basket ${pda.basket.toBase58()} (nonce ${NONCE}) deployed + verified`);
      console.log(`  share mint ${pda.shareMint.toBase58()} genesis=${GENESIS_SHARES}`);
      console.log(`  signature: ${signature}`);

      const entry = {
        factory: pda.factory.toBase58(),
        basket: pda.basket.toBase58(),
        shareMint: pda.shareMint.toBase58(),
        vaultAuthority: pda.vaultAuthority.toBase58(),
        creator,
        creatorShareAta: pda.creatorShareAta.toBase58(),
        treasury: creator,
        treasuryShareAta: pda.creatorShareAta.toBase58(),
        nonce: String(NONCE),
        numConstituents: sixArgs.constituents.length,
        constituents: sixArgs.constituents,
        constituentSymbols: SIX.map((c) => c.symbol),
        weightsBps: sixArgs.weightsBps,
        feesBps: { entry: ENTRY_FEE_BPS, exit: EXIT_FEE_BPS, mgmt: MGMT_FEE_BPS },
        seedAmounts: sixArgs.seedAmounts.map((s) => s.toString()),
        createTx: signature,
      };
      saveState({
        wizardCreateProof: {
          ...(loadState().wizardCreateProof ?? {}),
          deployed: { nonce: String(NONCE), basket: entry.basket, signature },
        },
        baskets: {
          ...((loadState().baskets ?? {}) as Record<string, unknown>),
          [String(NONCE)]: entry,
        },
      });
    });
  }

  if (hasStepFailure()) process.exit(1);
  console.log(
    "\nWIZARD CREATE PROOF: PASS (6-constituent v0+ALT + 2-constituent legacy, both simulate success on devnet)",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
