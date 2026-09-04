/**
 * Headless proof that the UI's EXACT client builders work on devnet.
 *
 * Imports buildMintInKind / buildRedeemInKind from app/lib/transactions.ts —
 * the same module the React app ships — targets the LIVE nonce-0 basket,
 * compiles each into a v0 message exactly like the UI's wallet adapter would,
 * signs with the payer keypair (standing in for Phantom), sends to devnet and
 * confirms.
 *
 * Assertions are made against the TRANSACTION'S OWN pre/post token balances
 * (meta.preTokenBalances vs meta.postTokenBalances) plus the program's
 * execution logs (basket/src/lib.rs msg! lines). Reading balances around the
 * tx is NOT safe on this cluster: the backend fee crank submits interleaved
 * accrue_management_fee txs, which would contaminate before/after reads. The
 * intra-tx deltas are exact; the only bounded quantity is the management fee
 * the instruction accrues internally (rate × 10 min ≤ ~215 shares here).
 *
 * Run (from the repo root, env block per AGENTS.md §13):
 *   FOLIOX_E2E_RPC_URL=https://api.devnet.solana.com \
 *   FOLIOX_E2E_PAYER=$PWD/scripts/.e2e-devnet/payer.json \
 *   FOLIOX_E2E_STATE_DIR=$PWD/scripts/.e2e-devnet \
 *   FOLIOX_E2E_TREASURY=$PWD/scripts/.e2e-devnet/treasury.json \
 *   npx tsx --tsconfig app/tsconfig.json scripts/verifyClientBuilders.ts
 *
 * The --tsconfig app/tsconfig.json flag is REQUIRED: it is what teaches tsx to
 * resolve the app's "@/lib/..." path aliases. The nonce-0 basket is selected
 * explicitly (FOLIOX_E2E_BASKET=0 semantics) so the proof stays pinned to the
 * original 3-constituent basket regardless of newer state entries.
 *
 * Signatures are recorded in state.json under `clientBuilderProof`.
 */

import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import {
  buildMintInKind,
  buildRedeemInKind,
  deriveAta as deriveAtaApp,
  deriveVaultAuthority as deriveVaultAuthorityApp,
} from "../app/lib/transactions.ts";
import {
  PACKET_LIMIT,
  ensureSol,
  fmtRaw,
  loadState,
  newConnection,
  payerKeypair,
  readMint,
  readTokenAmount,
  saveState,
  selectBasket,
  step,
  hasStepFailure,
} from "./lib.ts";

/** Mint 2% of the vault — small enough for the payer's balance, big enough to assert. */
const MINT_FRAC = 50n; // deposit = vault / 50
const REDEEM_FRAC = 2n; // redeem half of the payer's share balance
const SECONDS_PER_YEAR = 31_536_000n;
/** Generous bound for the intra-tx management-fee accrual (fee rate × 10 min). */
const ACCRUAL_BOUND_SEC = 600n;

function floorDiv(a: bigint, b: bigint): bigint {
  return a / b;
}

interface ConfirmedTx {
  logs: string[];
  /** owner:mint → exact post − pre token balance delta inside the tx. */
  deltas: Map<string, bigint>;
}

async function main() {
  const conn = newConnection();
  const payer = payerKeypair();
  // Pin the proof to the nonce-0 basket (see header).
  process.env.FOLIOX_E2E_BASKET = "0";
  const state = loadState();
  const { key: basketKey, entry } = selectBasket(state);
  const need: (keyof typeof entry)[] = ["basket", "shareMint", "creator", "treasury", "feesBps"];
  for (const k of need) {
    if (!entry[k]) throw new Error(`state.baskets[${basketKey}].${String(k)} missing`);
  }
  if (entry.nonce !== "0") {
    throw new Error(`expected the nonce-0 basket, got nonce ${entry.nonce} — run against the original state`);
  }
  const constituents = (entry.constituents ?? []).map((m) => new PublicKey(m));
  if (constituents.length === 0) throw new Error("basket entry has no constituents");
  const basket = new PublicKey(entry.basket);
  const shareMint = new PublicKey(entry.shareMint);
  const creator = new PublicKey(entry.creator);
  const treasury = new PublicKey(entry.treasury);
  const entryBps = entry.feesBps!.entry;
  const exitBps = entry.feesBps!.exit;
  const mgmtBps = BigInt(entry.feesBps!.mgmt);
  const user = payer.publicKey; // the signing wallet — Phantom's stand-in
  const userIsCreator = user.equals(creator);
  const vaultAuthority = deriveVaultAuthorityApp(basket)[0];

  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`basket: ${basket.toBase58()} (state.baskets[${basketKey}], ${constituents.length} constituents)`);
  console.log(`signer/user: ${user.toBase58()} (payer keypair — simulating what Phantom would sign, user_is_creator=${userIsCreator})`);
  await ensureSol(conn, payer, 0.5, 0);

  const core = {
    basket,
    factory: new PublicKey(entry.factory!),
    creator,
    treasury,
    shareMint,
    constituents: constituents.map((m) => m.toBase58()),
    user,
  };

  async function readSupply(): Promise<bigint> {
    const m = await readMint(conn, shareMint);
    if (!m) throw new Error("share mint missing");
    return m.supply;
  }
  async function readVaults(): Promise<bigint[]> {
    const out: bigint[] = [];
    for (const m of constituents) {
      const v = await readTokenAmount(conn, deriveAtaApp(vaultAuthority, m));
      if (v === null) throw new Error(`vault ATA missing for ${m.toBase58()}`);
      out.push(v);
    }
    return out;
  }

  /** Logs + exact intra-tx token deltas of a confirmed (versioned) transaction. */
  async function confirmedTx(sig: string): Promise<ConfirmedTx> {
    const tx = await conn.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta) throw new Error(`transaction ${sig} not found (not yet indexed?)`);
    const deltas = new Map<string, bigint>();
    const key = (owner: string, mint: string) => `${owner}:${mint}`;
    for (const b of tx.meta.preTokenBalances ?? []) {
      deltas.set(key(b.owner, b.mint), -BigInt(b.uiTokenAmount.amount));
    }
    for (const b of tx.meta.postTokenBalances ?? []) {
      const k = key(b.owner, b.mint);
      deltas.set(k, (deltas.get(k) ?? 0n) + BigInt(b.uiTokenAmount.amount));
    }
    return { logs: tx.meta.logMessages ?? [], deltas };
  }
  function firstMatch(logs: string[], re: RegExp): RegExpMatchArray | null {
    return logs.map((l) => l.match(re)).find(Boolean) ?? null;
  }
  const deltaOf = (tx: ConfirmedTx, owner: PublicKey, mint: PublicKey): bigint => {
    const v = tx.deltas.get(`${owner.toBase58()}:${mint.toBase58()}`);
    if (v === undefined) throw new Error(`no token balance entry for ${owner.toBase58()}:${mint.toBase58()}`);
    return v;
  };

  // Sign + send a UI-built instruction set exactly the way the wallet adapter
  // would: v0 message compiled by the app, signed locally, raw send to RPC.
  async function signAndSendLikePhantom(
    name: string,
    instructions: ReturnType<typeof buildMintInKind>["instructions"],
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("finalized");
    const message = new TransactionMessage({
      payerKey: user,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message([]);
    const tx = new VersionedTransaction(message);
    const size = tx.message.serialize().length + tx.signatures.length * 64;
    console.log(`  ${name}: v0 message ${size}B (limit ${PACKET_LIMIT}B), ${instructions.length} instruction(s)`);
    if (size > PACKET_LIMIT) throw new Error(`${name} does not fit the packet limit`);
    tx.sign([payer]);
    const signature = await conn.sendTransaction(tx, { skipPreflight: false });
    await conn.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, "confirmed");
    console.log(`  tx ${name}: ${signature}`);
    return signature;
  }

  // ---- mint_in_kind with the UI builder ----
  await step("app buildMintInKind → devnet (user = payer)", async () => {
    const supplyBefore = await readSupply();
    const vaults = await readVaults();
    const amounts = vaults.map((v) => floorDiv(v, MINT_FRAC));
    if (amounts.some((a) => a === 0n)) throw new Error("vault too small for a 2% deposit");
    for (let i = 0; i < constituents.length; i++) {
      const bal = await readTokenAmount(conn, deriveAtaApp(user, constituents[i]));
      if (bal === null || bal < amounts[i]) {
        throw new Error(`payer ATA[${i}] underfunded: ${bal} < ${amounts[i]}`);
      }
    }
    console.log(`  supply=${supplyBefore} deposits=[${amounts.join(", ")}]`);

    const built = buildMintInKind({ keys: core, amounts, vaultBalances: vaults });
    const sig = await signAndSendLikePhantom("app_mint_in_kind", built.instructions);

    const confirmed = await confirmedTx(sig);
    const mintLog = firstMatch(confirmed.logs, /mint_in_kind gross=(\d+) entry_fee=(\d+) net=(\d+)/);
    if (!mintLog) throw new Error(`program log missing gross/entry_fee/net:\n${confirmed.logs.join("\n")}`);
    const gross = BigInt(mintLog[1]);
    const entryFee = BigInt(mintLog[2]);
    const net = BigInt(mintLog[3]);
    if (entryFee !== floorDiv(gross * BigInt(entryBps), 10_000n)) {
      throw new Error(`entry_fee ${entryFee} != floor(gross*${entryBps}/10000)`);
    }
    if (net !== gross - entryFee) throw new Error(`net ${net} != gross - entry_fee`);

    // Exact intra-tx deltas: deposits leave the user's ATAs...
    for (let i = 0; i < constituents.length; i++) {
      const moved = deltaOf(confirmed, user, constituents[i]);
      if (moved !== -amounts[i]) {
        throw new Error(`user token[${i}] delta ${moved} != -${amounts[i]}`);
      }
    }
    // ...and the share legs reconcile: user/creator gets net + 90% of
    // (entry fee + intra-tx accrual); treasury the rest. Only the intra-tx
    // accrual is unknown — bounded by the fee rate over 10 minutes.
    const bound = floorDiv(supplyBefore * mgmtBps * ACCRUAL_BOUND_SEC, 10_000n * SECONDS_PER_YEAR);
    const creatorLegFixed = floorDiv(entryFee * 9000n, 10_000n);
    const userShareDelta = deltaOf(confirmed, user, shareMint);
    const treasuryShareDelta = deltaOf(confirmed, treasury, shareMint);
    if (userIsCreator) {
      // user's share ATA = creator's: net mint + 90% entry fee + 90% accrual.
      const accruedToCreator = userShareDelta - net - creatorLegFixed;
      if (accruedToCreator < 0n || accruedToCreator > floorDiv(bound * 9000n, 10_000n)) {
        throw new Error(`user(=creator) share delta ${userShareDelta} outside net ${net} + fee legs (accrual bound ${bound})`);
      }
    } else if (userShareDelta !== net) {
      throw new Error(`user share delta ${userShareDelta} != net ${net}`);
    }
    const accruedToTreasury = treasuryShareDelta - (entryFee - creatorLegFixed);
    if (accruedToTreasury < 0n || accruedToTreasury > bound) {
      throw new Error(`treasury share delta ${treasuryShareDelta} outside entry-fee leg + accrual bound ${bound}`);
    }
    console.log(`  program log: gross=${gross} entry_fee=${entryFee} net=${net}`);
    console.log(`  user share delta = +${userShareDelta} | treasury +${treasuryShareDelta} | intra-tx accrual within bound ${bound}`);
    saveState({
      clientBuilderProof: {
        ...(loadState().clientBuilderProof ?? {}),
        basket: basket.toBase58(),
        mintTx: sig,
        mintGross: gross.toString(),
      },
    });
  });

  // ---- redeem_in_kind with the UI builder ----
  await step("app buildRedeemInKind → devnet (user = payer)", async () => {
    const supplyBefore = await readSupply();
    const vaults = await readVaults();
    const userShareBal = (await readTokenAmount(conn, deriveAtaApp(user, shareMint)))!;
    const shares = floorDiv(userShareBal, REDEEM_FRAC);
    if (shares === 0n) throw new Error("user share balance too small to redeem");
    console.log(`  supply=${supplyBefore} shares_to_burn=${shares} vault=[${vaults.join(", ")}]`);

    const built = buildRedeemInKind({ keys: core, sharesToBurn: shares, vaultBalances: vaults });
    const sig = await signAndSendLikePhantom("app_redeem_in_kind", built.instructions);

    const confirmed = await confirmedTx(sig);
    const redeemLog = firstMatch(confirmed.logs, /redeem burn=(\d+) exit_fee=(\d+) out=\[([\d, ]+)\]/);
    if (!redeemLog) throw new Error(`program log missing burn/exit_fee/out:\n${confirmed.logs.join("\n")}`);
    const burn = BigInt(redeemLog[1]);
    const exitFee = BigInt(redeemLog[2]);
    const outs = redeemLog[3].split(",").map((s) => BigInt(s.trim()));
    if (exitFee !== floorDiv(shares * BigInt(exitBps), 10_000n)) {
      throw new Error(`exit_fee ${exitFee} != floor(shares*${exitBps}/10000)`);
    }
    if (burn !== shares - exitFee) throw new Error(`burn ${burn} != shares - exit_fee`);
    if (outs.length !== constituents.length) throw new Error(`program logged ${outs.length} outs != ${constituents.length}`);

    // Exact intra-tx deltas: each output lands in the user's ATA exactly as
    // the program logged, and the share ATA burns exactly `shares` (+ any
    // 90% intra-tx accrual leg when user == creator, bounded).
    for (let i = 0; i < constituents.length; i++) {
      const moved = deltaOf(confirmed, user, constituents[i]);
      if (moved !== outs[i]) {
        throw new Error(`user token[${i}] delta ${moved} != program out ${outs[i]}`);
      }
    }
    const bound = floorDiv(supplyBefore * mgmtBps * ACCRUAL_BOUND_SEC, 10_000n * SECONDS_PER_YEAR);
    // The exit fee is NOT burned: it is split 90/10 creator/treasury as shares.
    const exitFeeCreatorLeg = floorDiv(exitFee * 9000n, 10_000n);
    const userShareDelta = deltaOf(confirmed, user, shareMint);
    const feeLeg = userShareDelta + shares - (userIsCreator ? exitFeeCreatorLeg : 0n);
    if (userIsCreator) {
      if (feeLeg < 0n || feeLeg > floorDiv(bound * 9000n, 10_000n)) {
        throw new Error(`user share delta ${userShareDelta} != -shares + exit-fee leg ${exitFeeCreatorLeg} + accrual within bound ${bound}`);
      }
    } else if (userShareDelta !== -shares) {
      throw new Error(`user share delta ${userShareDelta} != -${shares}`);
    }
    const treasuryShareDelta = deltaOf(confirmed, treasury, shareMint);
    const treasuryFixed = exitFee - exitFeeCreatorLeg;
    if (treasuryShareDelta < treasuryFixed || treasuryShareDelta > treasuryFixed + bound) {
      throw new Error(`treasury share delta ${treasuryShareDelta} outside exit-fee leg ${treasuryFixed} + accrual bound ${bound}`);
    }
    console.log(`  program log: burn=${burn} exit_fee=${exitFee} out=[${outs.join(", ")}]`);
    console.log(`  outs received exactly (tx meta == program log) | user share delta ${userShareDelta} | treasury +${treasuryShareDelta}`);
    saveState({
      clientBuilderProof: {
        ...(loadState().clientBuilderProof ?? {}),
        redeemTx: sig,
        redeemedShares: shares.toString(),
      },
    });
  });

  if (hasStepFailure()) process.exit(1);
  console.log("\nCLIENT-BUILDER PROOF: PASS (both app builders confirmed on devnet)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
