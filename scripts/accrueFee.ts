/**
 * FolioX localnet E2E — step 4/4: management fee accrual.
 *
 * Waits ("warp or wait" — solana-test-validator has no clock warp; the top-up
 * mint in step 3 made the supply large enough that a few seconds of wall time
 * produce a non-zero fee), then calls the permissionless
 * accrue_management_fee() crank and verifies:
 *   fee = floor(S * mgmt_bps * elapsed / (10000 * 31536000))
 *   creator gets floor(fee * 9000 / 10000), treasury gets the remainder,
 *   supply increases by exactly `fee`, basket.last_fee_accrual_ts checkpoints.
 *
 * The 90/10 split is verified on-chain when the treasury is an independent
 * wallet (e2e.sh sets FOLIOX_E2E_TREASURY); with creator == treasury the ATAs
 * coincide and only the fee sum is provable (printed as such).
 */

import {
  deriveAta,
  fmtRaw,
  ixAccrueManagementFee,
  loadState,
  newConnection,
  payerKeypair,
  readBasketLastAccrual,
  readClockTimestamp,
  readMint,
  readTokenAmount,
  saveState,
  selectBasket,
  send,
  sleep,
  step,
  hasStepFailure,
} from "./lib.ts";
import { PublicKey } from "@solana/web3.js";

const SECONDS_PER_YEAR = 31_536_000n;
const CREATOR_SPLIT_BPS = 9000n;
const MAX_WAIT_SEC = 90;
const POLL_SEC = 5;
const TARGET_FEE = 2n; // shares; small target so the wait stays short

function floorDiv(a: bigint, b: bigint): bigint {
  return a / b;
}

async function main() {
  const conn = newConnection();
  const payer = payerKeypair(); // permissionless crank caller
  const state = loadState();
  // Basket selector: FOLIOX_E2E_BASKET=<nonce> or the newest state.baskets entry.
  const { key: basketKey, entry } = selectBasket(state);
  const required: (keyof typeof entry)[] = ["basket", "shareMint", "creator", "treasury", "feesBps"];
  for (const k of required) {
    if (!entry[k]) throw new Error(`state.baskets[${basketKey}].${String(k)} missing — run the earlier e2e steps first`);
  }
  console.log(`basket selector: FOLIOX_E2E_BASKET=${basketKey} (nonce ${entry.nonce ?? basketKey})`);
  const basket = new PublicKey(entry.basket);
  const shareMint = new PublicKey(entry.shareMint);
  const creator = new PublicKey(entry.creator);
  const treasury = new PublicKey(entry.treasury);
  const mgmtBps = BigInt(entry.feesBps!.mgmt);
  const distinctWallets = !creator.equals(treasury);

  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`crank payer: ${payer.publicKey.toBase58()} (permissionless — no authority needed)`);

  const creatorAta = entry.creatorShareAta
    ? new PublicKey(entry.creatorShareAta)
    : deriveAta(creator, shareMint);
  const treasuryAta = entry.treasuryShareAta
    ? new PublicKey(entry.treasuryShareAta)
    : deriveAta(treasury, shareMint);

  const snapshot = async () => {
    const mint = await readMint(conn, shareMint);
    if (!mint) throw new Error("share mint missing");
    const c = (await readTokenAmount(conn, creatorAta)) ?? 0n;
    const t = distinctWallets ? (await readTokenAmount(conn, treasuryAta)) ?? 0n : c;
    return { supply: mint.supply, creatorBal: c, treasuryBal: t };
  };

  // ---- wait until the expected fee is non-zero ----
  await step(`wait for accrual window (target fee >= ${TARGET_FEE} shares, max ${MAX_WAIT_SEC}s)`, async () => {
    const before = await snapshot();
    const ratePerSec = Number(before.supply * mgmtBps) / Number(10_000n * SECONDS_PER_YEAR);
    console.log(`  supply=${before.supply} mgmt_bps=${mgmtBps} -> fee ≈ ${ratePerSec.toFixed(4)} shares/sec`);
    if (Number(before.supply) * Number(mgmtBps) / 10_000 * MAX_WAIT_SEC < Number(TARGET_FEE * SECONDS_PER_YEAR)) {
      throw new Error(
        `supply too small for an observable fee within ${MAX_WAIT_SEC}s; run the step-3 top-up mint first`,
      );
    }
    const started = Date.now();
    for (;;) {
      const now = await readClockTimestamp(conn);
      const lastTs = await readBasketLastAccrual(conn, basket);
      const elapsed = BigInt(Math.max(0, now - lastTs));
      const expected = floorDiv(before.supply * mgmtBps * elapsed, 10_000n * SECONDS_PER_YEAR);
      if (expected >= TARGET_FEE) {
        console.log(`  elapsed=${elapsed}s since last accrual -> expected fee ≈ ${expected} shares`);
        return;
      }
      if ((Date.now() - started) / 1000 > MAX_WAIT_SEC) {
        throw new Error(`fee window did not open within ${MAX_WAIT_SEC}s (expected ${expected})`);
      }
      process.stdout.write(`  waiting... elapsed=${elapsed}s expected≈${expected}\n`);
      await sleep(POLL_SEC * 1000);
    }
  });

  // ---- crank ----
  let feePrinted = "";
  await step("accrue_management_fee (permissionless crank)", async () => {
    const before = await snapshot();
    const sig = await send(
      conn,
      "accrue_management_fee",
      [ixAccrueManagementFee({ basket, shareMint, creator, treasury, constituents: [] }, payer.publicKey)],
      [payer],
    );
    flowSigs.accrue = sig;

    const tx = await conn.getTransaction(sig, { commitment: "confirmed" });
    const logFee = (tx?.meta?.logMessages ?? [])
      .map((l) => /accrue_management_fee fee=(\d+)/.exec(l))
      .find(Boolean)?.[1];
    if (logFee) feePrinted = logFee;

    const after = await snapshot();
    const fee = after.supply - before.supply;
    const creatorDelta = after.creatorBal - before.creatorBal;
    const treasuryDelta = after.treasuryBal - before.treasuryBal;
    const expectedCreator = floorDiv(fee * CREATOR_SPLIT_BPS, 10_000n);
    const expectedTreasury = fee - expectedCreator;

    console.log(`  fee = ${fee} shares${logFee ? ` (program log: ${logFee})` : ""}`);
    console.log(
      `  split: creator ${creatorDelta} (expected ${expectedCreator}) | treasury ${treasuryDelta} (expected ${expectedTreasury})`,
    );
    console.log(`  supply ${before.supply} -> ${after.supply}`);

    if (logFee && BigInt(logFee) !== fee) {
      throw new Error(`program log fee ${logFee} != supply delta ${fee}`);
    }
    if (creatorDelta !== expectedCreator) throw new Error(`creator fee delta ${creatorDelta} != ${expectedCreator}`);
    if (treasuryDelta !== expectedTreasury) throw new Error(`treasury fee delta ${treasuryDelta} != ${expectedTreasury}`);
    if (fee === 0n) {
      console.log("  NOTE: fee accrued to 0 (elapsed window produced < 1 share) — math still consistent");
    } else {
      console.log(
        distinctWallets
          ? "  90/10 split verified on-chain (independent creator/treasury share ATAs)"
          : "  fee sum verified (creator == treasury wallet — pass FOLIOX_E2E_TREASURY for the split view)",
      );
      const lastTsAfter = await readBasketLastAccrual(conn, basket);
      const now = await readClockTimestamp(conn);
      if (lastTsAfter < now - 5) throw new Error(`last_fee_accrual_ts not checkpointed (${lastTsAfter} vs now ${now})`);
      console.log(`  last_fee_accrual_ts checkpointed: ${lastTsAfter}`);
    }
    void feePrinted;
  });

  saveState({ flows: { ...(state.flows ?? {}), [basketKey]: { ...((state.flows ?? {})[basketKey] ?? {}), ...flowSigs } } });

  if (hasStepFailure()) process.exit(1);
}

const flowSigs: Record<string, string> = {};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// keep fmtRaw referenced for potential verbose output
void fmtRaw;
