/**
 * FolioX localnet E2E — step 1/4: mock xStocks + whitelist.
 *
 * Creates 12 mock Token-2022 mints ("xStocks") via raw Token-2022 instructions
 * (no @solana/spl-token in this workspace — layouts mirrored in scripts/lib.ts):
 *   - initialize the mint account with the ScaledUiAmountConfig extension at
 *     multiplier 1.0 (falls back to a plain mint when the deployed Token-2022
 *     predates the extension — program math is raw-only, so behavior is
 *     identical; the script prints which path ran),
 *   - decimals 6, mint authority = payer, 10,000,000 tokens minted to the payer.
 * Then drives the whitelist program:
 *   - init_config  (authority = payer)
 *   - add_mint x12 (decimals 6, price_source "mock:<sym>")
 *
 * State written to $FOLIOX_E2E_STATE_DIR/state.json: mints[], whitelistConfig.
 *
 * Airdrop: the payer is funded via RPC airdrop (localnet only). Default payer
 * is <stateDir>/payer.json; override with FOLIOX_E2E_PAYER (keypair file).
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  createAtaIdempotent,
  deriveAta,
  deriveWhitelistConfig,
  deriveWhitelistedMint,
  ensureSol,
  fmtRaw,
  initializeMint2,
  initializeScaledUiAmountConfig,
  ixAddMint,
  ixInitConfig,
  loadState,
  mintTo,
  newConnection,
  payerKeypair,
  readMint,
  saveState,
  send,
  stateKeypair,
  step,
  TOKEN_2022_PROGRAM_ID,
  trySend,
  hasStepFailure,
} from "./lib.ts";

const MINT_DECIMALS = 6;
/** 10,000,000 tokens per mock xStock, minted to the payer. */
const PAYER_SUPPLY = 10_000_000n * 10n ** BigInt(MINT_DECIMALS);
/** Mint space candidates with the ScaledUiAmountConfig extension. */
const SCALED_SPACE_COMPACT = 82 + 1 + 4 + 56; // 143: base + type + TLV header + value
const SCALED_SPACE_PADDED = 82 + 83 + 1 + 4 + 56; // 226: interface doc-comment layout
const PLAIN_SPACE = 82;

const MOCKS = [
  { symbol: "TSLAx", priceSource: "mock:tsla", weightBps: 500 },
  { symbol: "NVDAx", priceSource: "mock:nvda", weightBps: 1800 },
  { symbol: "AAPLx", priceSource: "mock:aapl", weightBps: 1600 },
  { symbol: "MSFTx", priceSource: "mock:msft", weightBps: 1200 },
  { symbol: "AMZNx", priceSource: "mock:amzn", weightBps: 1000 },
  { symbol: "GOOGLx", priceSource: "mock:googl", weightBps: 1000 },
  { symbol: "METAx", priceSource: "mock:meta", weightBps: 900 },
  { symbol: "AMDx", priceSource: "mock:amd", weightBps: 500 },
  { symbol: "COINx", priceSource: "mock:coin", weightBps: 400 },
  { symbol: "MSTRx", priceSource: "mock:mstr", weightBps: 300 },
  { symbol: "HOODx", priceSource: "mock:hood", weightBps: 200 },
  { symbol: "SPYx", priceSource: "mock:spy", weightBps: 600 },
];
// weightBps is informational state only — the basket's real weights live in
// scripts/createBasket.ts. Assert the informational weights sum to 10000.
const WEIGHT_SUM = MOCKS.reduce((a, m) => a + m.weightBps, 0);
if (WEIGHT_SUM !== 10000) {
  throw new Error(`informational mock weights sum to ${WEIGHT_SUM}, expected 10000`);
}

async function main() {
  const conn = newConnection();
  const payer = payerKeypair();
  const savedState = loadState();
  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`payer: ${payer.publicKey.toBase58()}`);

  await ensureSol(conn, payer, 2, 10);

  // Stable per-symbol mint keypairs: a devnet re-run after a partial failure
  // (429 throttling) reuses the same addresses instead of littering orphans.
  const mintKeys = MOCKS.map((mock) => stateKeypair(`mint-${mock.symbol}.json`));
  const mintStates: { symbol: string; mint: string; scaled: boolean }[] = [];
  // Resume map from a previous partial run (symbol → mint address).
  const prior: Record<string, string> = savedState?.mintAddressBySymbol ?? {};
  if (savedState?.mints) {
    savedState.mints.forEach((addr: string, i: number) => {
      const sym: string | undefined = savedState.mockSymbols?.[i];
      if (sym && !prior[sym]) prior[sym] = addr;
    });
  }

  // ---- create the 12 mock Token-2022 mints (no program involved) ----
  await step("create mock xStocks (Token-2022, ScaledUiAmountConfig x1.0, decimals 6)", async () => {
    for (let i = 0; i < MOCKS.length; i++) {
      const mock = MOCKS[i];
      const mintKp = mintKeys[i];
      const mint = mintKp.publicKey;
      const existingAddr = prior[mock.symbol] ? new PublicKey(prior[mock.symbol]) : null;
      const existing = existingAddr ? await conn.getAccountInfo(existingAddr) : null;
      if (existingAddr && existing) {
        // Reuse a mint created by an earlier (partial) run — verify + top up.
        if (!existing.owner.equals(TOKEN_2022_PROGRAM_ID)) {
          throw new Error(`existing ${mock.symbol} mint ${existingAddr.toBase58()} is not Token-2022`);
        }
        const st = await readMint(conn, existingAddr);
        if (!st || st.decimals !== MINT_DECIMALS) {
          throw new Error(`existing ${mock.symbol} mint decimals mismatch`);
        }
        const payerAta = deriveAta(payer.publicKey, existingAddr);
        const bal = BigInt(
          await conn.getTokenAccountBalance(payerAta).then((r) => r.value.amount).catch(() => "0"),
        );
        if (bal < PAYER_SUPPLY) {
          await send(conn, `mint_to(${mock.symbol}, top-up)`, [
            createAtaIdempotent(payer.publicKey, payer.publicKey, existingAddr),
            mintTo(existingAddr, payerAta, payer.publicKey, PAYER_SUPPLY - bal),
          ], [payer]);
        }
        mintStates.push({ symbol: mock.symbol, mint: existingAddr.toBase58(), scaled: st!.scaledExtension });
        console.log(`  ${mock.symbol}: ${existingAddr.toBase58()} [reused from prior run] payer ATA ${fmtRaw(bal)}`);
        continue;
      }
      if (await conn.getAccountInfo(mint)) {
        throw new Error(`mock mint ${mint.toBase58()} already exists (fresh state dir + validator required)`);
      }
      const payerAta = deriveAta(payer.publicKey, mint);
      const tail = [
        createAtaIdempotent(payer.publicKey, payer.publicKey, mint),
        mintTo(mint, payerAta, payer.publicKey, PAYER_SUPPLY),
      ];

      // Attempt 1/2: ScaledUiAmountConfig extension (compact 143B, then the
      // padded 226B layout from the interface doc comment). Attempt 3: plain
      // mint (extension unsupported by the deployed Token-2022). A failed tx
      // is atomic, so probes leave nothing behind.
      const attempts: { label: string; space: number; ixs: ReturnType<typeof initializeMint2>[] }[] = [
        {
          label: `scaled(${SCALED_SPACE_COMPACT}B)`,
          space: SCALED_SPACE_COMPACT,
          ixs: [
            initializeScaledUiAmountConfig(mint, 1.0, payer.publicKey),
            initializeMint2(mint, MINT_DECIMALS, payer.publicKey, null),
          ],
        },
        {
          label: `scaled(${SCALED_SPACE_PADDED}B)`,
          space: SCALED_SPACE_PADDED,
          ixs: [
            initializeScaledUiAmountConfig(mint, 1.0, payer.publicKey),
            initializeMint2(mint, MINT_DECIMALS, payer.publicKey, null),
          ],
        },
        {
          label: "plain(82B)",
          space: PLAIN_SPACE,
          ixs: [initializeMint2(mint, MINT_DECIMALS, payer.publicKey, null)],
        },
      ];

      let done = false;
      let usedLabel = "";
      for (const a of attempts) {
        const ixs = [
          SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mint,
            space: a.space,
            lamports: await conn.getMinimumBalanceForRentExemption(a.space),
            programId: TOKEN_2022_PROGRAM_ID,
          }),
          ...a.ixs,
          ...tail,
        ];
        const ok = await trySend(conn, ixs, [payer, mintKp]);
        if (ok) {
          usedLabel = a.label;
          done = true;
          break;
        }
      }
      if (!done) throw new Error(`could not create mock mint ${mock.symbol} in any layout`);

      const state = await readMint(conn, mint);
      if (!state) throw new Error(`mint ${mock.symbol} vanished after creation`);
      if (state.decimals !== MINT_DECIMALS) {
        throw new Error(`mint ${mock.symbol} decimals ${state.decimals} != ${MINT_DECIMALS}`);
      }
      if (state.supply < PAYER_SUPPLY) throw new Error(`mint ${mock.symbol} supply short`);
      const payerBal = await conn
        .getTokenAccountBalance(deriveAta(payer.publicKey, mint))
        .then((r) => r.value.amount)
        .catch(() => "0");
      if (BigInt(payerBal) < PAYER_SUPPLY) throw new Error(`payer ATA short for ${mock.symbol}`);
      // Persist the address immediately so a mid-loop crash (devnet 429s)
      // resumes with the same mints instead of creating orphans.
      savedState.mintAddressBySymbol = {
        ...((savedState?.mintAddressBySymbol as Record<string, string>) ?? {}),
        [mock.symbol]: mint.toBase58(),
      };
      saveState({ mintAddressBySymbol: savedState.mintAddressBySymbol });
      mintStates.push({ symbol: mock.symbol, mint: mint.toBase58(), scaled: state.scaledExtension });
      console.log(
        `  ${mock.symbol}: ${mint.toBase58()} [${usedLabel}] payer ATA ${fmtRaw(BigInt(payerBal))}`,
      );
    }
    if (!mintStates.some((m) => m.scaled)) {
      console.log(
        "  NOTE: deployed Token-2022 lacks the ScaledUiAmountConfig extension; mock mints created without it. Program accounting is raw-only — unaffected (multiplier 1.0 is a no-op).",
      );
    }
  });

  // ---- whitelist program ----
  const config = deriveWhitelistConfig();

  await step("whitelist init_config", async () => {
    if (await conn.getAccountInfo(config)) {
      console.log(`  config exists (${config.toBase58()}) — skipping init`);
      return;
    }
    await send(conn, "init_config", [ixInitConfig(payer.publicKey)], [payer]);
    if (!(await conn.getAccountInfo(config))) throw new Error("config not created");
  });

  await step(`whitelist add_mint x${MOCKS.length} (status Active)`, async () => {
    for (let i = 0; i < mintStates.length; i++) {
      const mint = new PublicKey(mintStates[i].mint);
      const wlPda = deriveWhitelistedMint(mint);
      if (await conn.getAccountInfo(wlPda)) {
        console.log(`  whitelisted already: ${mintStates[i].symbol}`);
        continue;
      }
      // One tx per add_mint keeps failures attributable to a single mint.
      await send(
        conn,
        `add_mint(${mintStates[i].symbol})`,
        [ixAddMint(payer.publicKey, mint, MINT_DECIMALS, MOCKS[i].priceSource)],
        [payer],
      );
    }
  });

  await step("verify WhitelistedMint records (Active, decimals cached)", async () => {
    for (let i = 0; i < mintStates.length; i++) {
      const mint = new PublicKey(mintStates[i].mint);
      const wlPda = deriveWhitelistedMint(mint);
      const info = await conn.getAccountInfo(wlPda);
      if (!info) throw new Error(`WhitelistedMint PDA missing for ${mintStates[i].symbol}`);
      // 8 disc + 32 mint + 1 decimals + 8 watermark + 1 status
      const status = info.data[49];
      const decimals = info.data[40];
      const storedMint = new PublicKey(info.data.subarray(8, 40));
      if (!storedMint.equals(mint)) throw new Error(`record mint mismatch for ${mintStates[i].symbol}`);
      if (status !== 0) throw new Error(`record status ${status} != Active(0) for ${mintStates[i].symbol}`);
      if (decimals !== MINT_DECIMALS) throw new Error(`record decimals ${decimals} != ${MINT_DECIMALS}`);
      console.log(`  ${mintStates[i].symbol}: ${wlPda.toBase58()} status=Active decimals=${decimals}`);
    }
  });

  // mintStates (actual on-chain addresses — reused mints may differ from the
  // stable keypair files) is the source of truth.
  saveState({
    mints: mintStates.map((m) => m.mint),
    mockSymbols: mintStates.map((m) => m.symbol),
    weightsBps: MOCKS.map((m) => m.weightBps),
    mintDecimals: MINT_DECIMALS,
    whitelistConfig: config.toBase58(),
  });
  console.log(`\nstate saved: ${mintStates.length} mock mints whitelisted`);
  if (hasStepFailure()) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
