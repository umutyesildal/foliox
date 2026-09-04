/**
 * FolioX devnet faucet — sends a starter pack of every mock mint from the e2e
 * payer to a target wallet, so a real wallet can hold a position, mint a
 * basket in-kind, or seed a new basket in the create wizard.
 *
 * Starter pack: 100,000 tokens of each of the mock mints listed in
 * state.json (`mints`, with `mintDecimals`), read from the state dir
 * (FOLIOX_E2E_STATE_DIR — the devnet state lives at scripts/.e2e-devnet).
 * The target's ATAs are created idempotently (ATA program CreateIdempotent),
 * so re-running is safe; transfers are plain Token-2022 transfer_checked.
 *
 * Usage (env block identical to the other e2e scripts — see AGENTS.md §13):
 *
 *   FOLIOX_E2E_RPC_URL=https://api.devnet.solana.com \
 *   FOLIOX_E2E_STATE_DIR=$PWD/scripts/.e2e-devnet \
 *   npx tsx scripts/faucet.ts --to <WALLET_PUBKEY_OR_KEYFILE_NAME>
 *
 * `--to` accepts a base58 pubkey, or a keypair file name inside the state dir
 * (e.g. "user2.json" → its pubkey). FOLIOX_FAUCET_TO is the env fallback.
 * The payer is FOLIOX_E2E_PAYER or scripts/.e2e-devnet/payer.json — it needs
 * SOL for fees (no airdrop on public clusters; scripts/lib.ts enforces ≥0.3).
 * One transaction per mint, paced + retried by scripts/lib.ts `send` (the
 * public RPC rate-limits — do not remove the spacing).
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

import {
  createAtaIdempotent,
  deriveAta,
  ensureSol,
  fmtRaw,
  keypairFilename,
  loadState,
  newConnection,
  payerKeypair,
  readTokenAmount,
  send,
  step,
  hasStepFailure,
  transferChecked,
} from "./lib.ts";

/** Starter pack per mint: 100,000 whole tokens (raw = ×10^decimals). */
const TOKENS_PER_MINT = 100_000n;

function parseTarget(raw: string | undefined): { pubkey: PublicKey; label: string } {
  const value = (raw ?? "").trim();
  if (!value) {
    throw new Error(
      "usage: npx tsx scripts/faucet.ts --to <WALLET_PUBKEY | keyfile.json>  (or set FOLIOX_FAUCET_TO)",
    );
  }
  // A base58 pubkey is 32-44 chars; anything with a .json suffix (or that
  // fails base58 decode) is treated as a state-dir keyfile name.
  if (!value.endsWith(".json")) {
    try {
      const pubkey = new PublicKey(value);
      return { pubkey, label: value };
    } catch {
      // fall through to keyfile handling
    }
  }
  const file = keypairFilename(value);
  const secret = JSON.parse(fs.readFileSync(file, "utf8")) as number[];
  const pubkey = Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey;
  return { pubkey, label: `${value} → ${pubkey.toBase58()}` };
}

async function main() {
  const argIndex = process.argv.indexOf("--to");
  const targetArg = argIndex >= 0 ? process.argv[argIndex + 1] : undefined;
  const { pubkey: target, label } = parseTarget(targetArg ?? process.env.FOLIOX_FAUCET_TO);

  const conn = newConnection();
  const payer = payerKeypair();
  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`payer (faucet): ${payer.publicKey.toBase58()}`);
  console.log(`target: ${label}`);
  await ensureSol(conn, payer, 0.5, 0);

  const state = loadState();
  const mints: string[] = state.mints ?? [];
  const symbols: string[] = state.mockSymbols ?? [];
  const decimals = Number(state.mintDecimals ?? 6);
  if (mints.length === 0) {
    throw new Error("state.json has no mints — run scripts/createWhitelist.ts first");
  }
  const amountRaw = TOKENS_PER_MINT * 10n ** BigInt(decimals);

  // Pre-flight: the payer must actually hold the pack it is about to give.
  let shortfall = 0;
  for (const mint of mints) {
    const mintKey = new PublicKey(mint);
    const bal = (await readTokenAmount(conn, deriveAta(payer.publicKey, mintKey))) ?? 0n;
    if (bal < amountRaw) shortfall += 1;
  }
  if (shortfall > 0) {
    throw new Error(
      `payer is short on ${shortfall}/${mints.length} mock mints — refill via scripts/mintAndRedeem.ts topup or mint fresh supply`,
    );
  }

  console.log(`pack: ${TOKENS_PER_MINT} tokens × ${mints.length} mints (${amountRaw} raw each)`);

  for (let i = 0; i < mints.length; i++) {
    const mintKey = new PublicKey(mints[i]);
    const symbol = symbols[i] ?? mintKey.toBase58().slice(0, 6);
    const payerAta = deriveAta(payer.publicKey, mintKey);
    const targetAta = deriveAta(target, mintKey);
    await step(`faucet ${symbol} → ${target.toBase58().slice(0, 6)}…`, async () => {
      // CreateIdempotent + transfer_checked in ONE transaction: idempotent on
      // re-run (the ATA create is a no-op once it exists), atomic per mint.
      await send(conn, `faucet_${symbol}`, [createAtaIdempotent(payer.publicKey, target, mintKey), transferChecked(payerAta, mintKey, targetAta, payer.publicKey, amountRaw, decimals)], [payer]);
      const bal = (await readTokenAmount(conn, targetAta)) ?? 0n;
      if (bal < amountRaw) throw new Error(`target balance ${bal} < ${amountRaw} after transfer`);
      console.log(`  target ATA ${symbol}: ${fmtRaw(bal, decimals)}`);
    });
  }

  if (hasStepFailure()) process.exit(1);
  console.log(
    `\nFAUCET: PASS — sent ${TOKENS_PER_MINT} × ${mints.length} tokens to ${target.toBase58()}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
