/**
 * FolioX localnet E2E — step 1/4: mock xStocks + whitelist.
 *
 * Creates 3 mock Token-2022 mints ("xStocks") via raw Token-2022 instructions
 * (no @solana/spl-token in this workspace — layouts mirrored in scripts/lib.ts):
 *   - initialize the mint account with the ScaledUiAmountConfig extension at
 *     multiplier 1.0 (falls back to a plain mint when the deployed Token-2022
 *     predates the extension — program math is raw-only, so behavior is
 *     identical; the script prints which path ran),
 *   - decimals 6, mint authority = payer, 10,000,000 tokens minted to the payer.
 * Then drives the whitelist program:
 *   - init_config  (authority = payer)
 *   - add_mint x3  (decimals 6, price_source "mock:<sym>")
 *
 * State written to $FOLIOX_E2E_STATE_DIR/state.json: mints[], whitelistConfig.
 *
 * Airdrop: the payer is funded via RPC airdrop (localnet only). Default payer
 * is <stateDir>/payer.json; override with FOLIOX_E2E_PAYER (keypair file).
 */

import {
  Connection,
  Keypair,
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
  mintTo,
  newConnection,
  payerKeypair,
  readMint,
  saveState,
  send,
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
  { symbol: "TSLAx", priceSource: "mock:tsla", weightBps: 5000 },
  { symbol: "NVDAx", priceSource: "mock:nvda", weightBps: 3000 },
  { symbol: "AAPLx", priceSource: "mock:aapl", weightBps: 2000 },
];

async function main() {
  const conn = newConnection();
  const payer = payerKeypair();
  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`payer: ${payer.publicKey.toBase58()}`);

  await ensureSol(conn, payer, 2, 10);

  const mintKeys = MOCKS.map(() => Keypair.generate());
  const mintStates: { symbol: string; mint: string; scaled: boolean }[] = [];

  // ---- create the 3 mock Token-2022 mints (no program involved) ----
  await step("create mock xStocks (Token-2022, ScaledUiAmountConfig x1.0, decimals 6)", async () => {
    for (let i = 0; i < MOCKS.length; i++) {
      const mock = MOCKS[i];
      const mintKp = mintKeys[i];
      const mint = mintKp.publicKey;
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

  await step("whitelist add_mint x3 (status Active)", async () => {
    for (let i = 0; i < MOCKS.length; i++) {
      const mint = mintKeys[i].publicKey;
      const wlPda = deriveWhitelistedMint(mint);
      if (await conn.getAccountInfo(wlPda)) {
        console.log(`  whitelisted already: ${MOCKS[i].symbol}`);
        continue;
      }
      // One tx per add_mint keeps failures attributable to a single mint.
      await send(
        conn,
        `add_mint(${MOCKS[i].symbol})`,
        [ixAddMint(payer.publicKey, mint, MINT_DECIMALS, MOCKS[i].priceSource)],
        [payer],
      );
    }
  });

  await step("verify WhitelistedMint records (Active, decimals cached)", async () => {
    for (let i = 0; i < MOCKS.length; i++) {
      const mint = mintKeys[i].publicKey;
      const wlPda = deriveWhitelistedMint(mint);
      const info = await conn.getAccountInfo(wlPda);
      if (!info) throw new Error(`WhitelistedMint PDA missing for ${MOCKS[i].symbol}`);
      // 8 disc + 32 mint + 1 decimals + 8 watermark + 1 status
      const status = info.data[49];
      const decimals = info.data[40];
      const storedMint = new PublicKey(info.data.subarray(8, 40));
      if (!storedMint.equals(mint)) throw new Error(`record mint mismatch for ${MOCKS[i].symbol}`);
      if (status !== 0) throw new Error(`record status ${status} != Active(0) for ${MOCKS[i].symbol}`);
      if (decimals !== MINT_DECIMALS) throw new Error(`record decimals ${decimals} != ${MINT_DECIMALS}`);
      console.log(`  ${MOCKS[i].symbol}: ${wlPda.toBase58()} status=Active decimals=${decimals}`);
    }
  });

  saveState({
    mints: mintKeys.map((k) => k.publicKey.toBase58()),
    mockSymbols: MOCKS.map((m) => m.symbol),
    weightsBps: MOCKS.map((m) => m.weightBps),
    mintDecimals: MINT_DECIMALS,
    whitelistConfig: config.toBase58(),
  });
  console.log(`\nstate saved: ${mintKeys.length} mock mints whitelisted`);

  if (hasStepFailure()) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
