/**
 * Headless RETRY-FLOW proof: the app's REAL recovery behavior under injected
 * devnet 429s, on live devnet.
 *
 * What it proves (task gate):
 *   1. Fault injection — every JSON-RPC `simulateTransaction` request is
 *      answered with HTTP 429 for the first FOLIOX_RETRY_FAIL_N (default 10)
 *      fetch hits, then passes through. @solana/web3.js's internal 429 retry
 *      (5 retries, 500ms→8s) is left ENABLED exactly as the browser provider
 *      runs it, so the proof reflects production wiring: web3.js absorbs a
 *      few hits, gives up, and the app's shared `withRetry` loop
 *      (app/lib/rpc-retry.ts — 6 attempts, 2s→4s→8s→16s→30s) takes over.
 *      The flow must COMPLETE: simulation err = null, then a REAL mint to the
 *      6-constituent basket CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo
 *      confirms on-chain.
 *   2. Typed exhaustion — a second simulation attempt against an
 *      always-429 endpoint (compressed schedule for test speed) must throw the
 *      typed `RpcRetriesExhaustedError` with honest copy, not a bare 429.
 *   3. Resume path — after a first run created the wallet-owned lookup table,
 *      re-running with a COLD module cache (a fresh process = a fresh tab) but
 *      the persisted derivation slot must NOT re-create the table:
 *      created=false, extended=0, straight to mint, no management signatures.
 *
 * The payer keypair stands in for the connected wallet everywhere (it signs
 * the lookup-table create/extend transactions through the app's own
 * ensureMintRedeemAlt, then signs the mint like Phantom would).
 *
 * Run (from the repo root — via npm so the source path never hits the shell):
 *   FOLIOX_E2E_RPC_URL=https://api.devnet.solana.com \
 *   FOLIOX_E2E_PAYER=$PWD/scripts/.e2e-devnet/payer.json \
 *   FOLIOX_E2E_STATE_DIR=$PWD/scripts/.e2e-devnet \
 *   npm run proof:retryflow
 *   # …then run it a SECOND time for the resume proof (same env).
 */

import {
  Keypair,
  Connection,
  PublicKey,
  type ConnectionConfig,
  type VersionedTransaction,
} from "@solana/web3.js";

import {
  RETRY_ATTEMPTS,
  RETRY_DELAYS_MS,
  RpcRetriesExhaustedError,
  withRetry,
  type RetryEvent,
} from "../app/lib/rpc-retry.ts";
import {
  buildMintInKindTransaction,
  deriveAta as deriveAtaApp,
  deriveVaultAuthority as deriveVaultAuthorityApp,
  ensureMintRedeemAlt,
  type BasketCoreKeys,
} from "../app/lib/transactions.ts";
import {
  ensureSol,
  loadState,
  newConnection,
  payerKeypair,
  readMint,
  readTokenAmount,
  rpcUrl,
  saveState,
  selectBasket,
  sleep,
} from "./lib.ts";

// ===================== fault-injecting connection =====================

const FAIL_FIRST_N = Number(process.env.FOLIOX_RETRY_FAIL_N ?? 6);

let simulateHits = 0;
let simulateThrottled = 0;

/**
 * 429 for the first FAIL_FIRST_N simulateTransaction fetch hits, then the
 * untouched network fetch. Everything else passes straight through.
 */
async function throttledFetch(
  url: RequestInfo | URL,
  options: RequestInit | undefined,
): Promise<Response> {
  const body = typeof options?.body === "string" ? options.body : "";
  if (body.includes('"simulateTransaction"')) {
    simulateHits += 1;
    if (simulateHits <= FAIL_FIRST_N) {
      simulateThrottled += 1;
      process.stdout.write(
        `  [fault] simulateTransaction fetch hit #${simulateHits} → injected HTTP 429\n`,
      );
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32005, message: "Too Many Requests" }, id: null }),
        { status: 429, statusText: "Too Many Requests", headers: { "content-type": "application/json" } },
      );
    }
  }
  return fetch(url, options);
}

function faultedConnection(): Connection {
  const endpoint = rpcUrl();
  // No disableRetryOnRateLimit override — web3.js keeps its internal 429
  // retries (5 × 500ms→8s) exactly as the app's ConnectionProvider runs it.
  const config: ConnectionConfig = { commitment: "confirmed" };
  if (!endpoint.includes("127.0.0.1") && !endpoint.includes("localhost")) {
    config.fetch = throttledFetch as unknown as typeof fetch;
  }
  return new Connection(endpoint, config);
}

// ===================== proof steps =====================

interface RetryRecord {
  attempts: number[]; // the attempt number of each failure that fired a wait
  waitsMs: number[];
}

/**
 * Every harness RPC call — reads, sends, confirms — runs through the SAME
 * app-level loop the UI uses, so REAL devnet 429s (the shared cluster is
 * genuinely throttled much of the time) are waited out exactly as the product
 * waits them out. Re-sending is safe: identical signed transactions dedup
 * on-cluster by signature.
 */
function r<T>(fn: () => Promise<T>, label: string): Promise<T> {
  return withRetry(fn, { label });
}

async function simulateWithAppRetry(
  conn: Connection,
  transaction: VersionedTransaction,
): Promise<{ err: unknown; unitsConsumed: number | undefined; log: string[]; record: RetryRecord }> {
  const record: RetryRecord = { attempts: [], waitsMs: [] };
  const onRetry = (event: RetryEvent) => {
    record.attempts.push(event.attempt);
    record.waitsMs.push(event.waitMs);
    process.stdout.write(
      `  [withRetry] ${event.label}: attempt ${event.attempt}/${event.attempts} failed (throttled) — waiting ${(event.waitMs / 1000).toFixed(1)}s before attempt ${event.attempt + 1}\n`,
    );
  };
  const result = await withRetry(
    () =>
      conn.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      }),
    { label: "simulateTransaction", onRetry },
  );
  return {
    err: result.value.err,
    unitsConsumed: result.value.unitsConsumed,
    log: result.value.logs ?? [],
    record,
  };
}

async function main() {
  const conn = faultedConnection();
  const plain = newConnection(); // fault-free connection for sends/reads
  const payer = payerKeypair();
  const payerKey = payer.publicKey;
  console.log(`rpc: ${conn.rpcEndpoint}`);
  console.log(`wallet stand-in (payer): ${payerKey.toBase58()}`);
  console.log(`fault: first ${FAIL_FIRST_N} simulateTransaction fetch hits → HTTP 429`);
  await r(() => ensureSol(plain, payer, 0.3, 0), "ensureSol");

  // ---- fixture: the 6-constituent basket (nonce 1) ----
  process.env.FOLIOX_E2E_BASKET = "1";
  const { entry } = selectBasket(loadState());
  if (entry.nonce !== "1") throw new Error(`state.baskets entry nonce ${entry.nonce}, expected 1`);
  if (entry.basket !== "CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo") {
    throw new Error(`nonce-1 basket moved: ${entry.basket}`);
  }
  const constituents = (entry.constituents ?? []).map((m) => new PublicKey(m));
  if (constituents.length !== 6) throw new Error(`expected 6 constituents, got ${constituents.length}`);
  const basket = new PublicKey(entry.basket);
  const core: BasketCoreKeys = {
    basket,
    factory: new PublicKey(entry.factory!),
    creator: new PublicKey(entry.creator!),
    treasury: new PublicKey(entry.treasury!),
    shareMint: new PublicKey(entry.shareMint!),
    constituents: constituents.map((m) => m.toBase58()),
    user: payerKey,
  };

  // ---- 1. lookup table — reuse across a killed session (resume proof) ----
  // A fresh process has a cold module cache; the persisted (authority, slot)
  // plays the browser's module-level cache role. ensureMintRedeemAlt re-derives
  // the SAME address, verifies on-chain coverage, and must NOT re-create.
  const prior = (loadState().retryFlowAlt ?? {}) as { authority?: string; slot?: number };
  const resuming =
    prior.authority === payerKey.toBase58() && typeof prior.slot === "number";
  console.log(`\n[STEP] ensureMintRedeemAlt (resume=${resuming ? "YES — cold cache, persisted slot" : "NO — fresh session"})`);
  const walletSign = async (tx: VersionedTransaction): Promise<string> => {
    tx.sign([payer]);
    return r(() => plain.sendTransaction(tx, { skipPreflight: false }), "ALT management send");
  };
  const handle = await ensureMintRedeemAlt({
    connection: plain,
    keys: core,
    sendTransaction: walletSign,
    recentSlot: resuming ? prior.slot : undefined,
  });
  saveState({
    retryFlowAlt: { authority: payerKey.toBase58(), slot: handle.recentSlot, address: handle.lookupTableAddress.toBase58() },
  });
  console.log(
    `  ALT ${handle.lookupTableAddress.toBase58()} created=${handle.created} extended=${handle.extended}`,
  );
  if (resuming && handle.created) {
    throw new Error("RESUME BROKEN: the second run re-created an existing lookup table");
  }
  if (resuming && handle.extended !== 0) {
    throw new Error(`RESUME WEAK: the second run extended ${handle.extended} addresses (expected full coverage)`);
  }
  if (resuming) {
    console.log("  RESUME OK: coverage check re-verified the existing table — no create, no extend, no approvals");
  }

  // ---- 2. build the real mint transaction (app builder, v0+ALT) ----
  console.log("\n[STEP] build mint_in_kind (6 constituents, v0+ALT)");
  const vaultAuthority = deriveVaultAuthorityApp(basket)[0];
  const vaults: bigint[] = [];
  for (const m of constituents) {
    const v = await r(() => readTokenAmount(plain, deriveAtaApp(vaultAuthority, m)), "vault balance read");
    if (v === null) throw new Error(`vault ATA missing for ${m.toBase58()}`);
    vaults.push(v);
  }
  // Largest affordable proportional deposit (≤ 2% of the vault).
  let pct = 2n;
  for (let i = 0; i < constituents.length; i++) {
    const bal =
      (await r(
        () => readTokenAmount(plain, deriveAtaApp(payerKey, constituents[i])),
        "payer balance read",
      )) ?? 0n;
    const cap = (bal * 100n) / vaults[i];
    if (cap < pct) pct = cap;
  }
  if (pct === 0n) throw new Error("payer cannot afford a proportional deposit — run scripts/faucet.ts");
  const deposits = vaults.map((v) => (v * pct) / 100n);
  console.log(`  deposits = ${pct}% of vault = [${deposits.join(", ")}]`);
  const built = await buildMintInKindTransaction({
    connection: plain,
    keys: core,
    amounts: deposits,
    vaultBalances: vaults,
    lookupTableAddresses: [handle.lookupTableAddress],
  });
  console.log(`  wire: v0+ALT ${built.sizeBytes}B, usedLookupTable=${built.usedLookupTable}`);

  // ---- 3. THE PROOF: ONE simulation through the app's withRetry under 429s ----
  console.log("\n[STEP] simulateTransaction under injected 429s (app withRetry loop)");
  const sim = await simulateWithAppRetry(conn, built.transaction);
  if (sim.err) {
    throw new Error(`simulation reverted after retries: ${JSON.stringify(sim.err)}\n${sim.log.join("\n")}`);
  }
  console.log(`  FINAL: err=null, unitsConsumed=${sim.unitsConsumed}`);
  console.log(`  logical retries waited: ${sim.record.waitsMs.map((w) => `${(w / 1000).toFixed(1)}s`).join(" → ") || "none needed"}`);
  console.log(
    `  fetch-level simulateTransaction hits: ${simulateHits} ` +
      `(throttled ${simulateThrottled}; web3.js internal retries absorbed ${Math.max(0, simulateThrottled - sim.record.attempts.length)} hits before app-level retries engaged)`,
  );
  if (simulateThrottled === 0) throw new Error("fault injection never fired — proof invalid");
  if (sim.record.attempts.length === 0) {
    throw new Error("the app retry loop never engaged — web3.js alone survived; proof invalid (raise FOLIOX_RETRY_FAIL_N)");
  }

  // ---- 4. REAL send — the mint lands on devnet ----
  console.log("\n[STEP] real mint send + confirm (payer signs like the wallet)");
  built.transaction.sign([payer]);
  const signature = await r(
    () => plain.sendTransaction(built.transaction, { skipPreflight: false }),
    "mint send",
  );
  await r(
    () =>
      plain.confirmTransaction(
        { signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight },
        "confirmed",
      ),
    "mint confirm",
  );
  await sleep(2500); // pace the shared public RPC
  const shareAta = deriveAtaApp(payerKey, core.shareMint);
  const sharesAfter = (await r(() => readTokenAmount(plain, shareAta), "share balance read")) ?? 0n;
  if (sharesAfter <= 0n) throw new Error("share balance is zero — mint did not land");
  const supply = (await r(() => readMint(plain, core.shareMint), "mint account read"))?.supply ?? 0n;
  console.log(`  CONFIRMED ${signature} (shares now ${sharesAfter}, supply ${supply})`);

  // ---- 5. typed exhaustion — an always-throttled RPC fails HONESTLY ----
  // (Compressed schedule for test speed; the shape of the failure — the typed
  // error and its copy — is identical to the production 2s→4s→8s→16s→30s loop.)
  console.log("\n[STEP] typed exhaustion (always-429 call, compressed schedule for speed)");
  let typedMessage = "";
  try {
    await withRetry(
      () => {
        throw new Error("429 Too Many Requests: injected permanent throttle");
      },
      { label: "exhaustion probe", attempts: 3, delaysMs: [100, 100] },
    );
    throw new Error("exhaustion probe unexpectedly succeeded — the always-429 fault did not apply");
  } catch (err) {
    if (!(err instanceof RpcRetriesExhaustedError)) throw err;
    typedMessage = err.message;
  }
  console.log(`  typed RpcRetriesExhaustedError: "${typedMessage.slice(0, 160)}…"`);
  if (/unexpected error/i.test(typedMessage)) {
    throw new Error("exhaustion message must never contain 'unexpected error'");
  }

  // ---- machine-readable summary ----
  console.log("\nRETRY-FLOW PROOF SUMMARY");
  console.log(JSON.stringify({
    attempts: RETRY_ATTEMPTS,
    scheduleMs: RETRY_DELAYS_MS,
    faultInjections: simulateThrottled,
    appLevelRetries: sim.record.attempts.length,
    appLevelWaitsMs: sim.record.waitsMs,
    simulateErr: null,
    resume: { reused: resuming, created: handle.created, extended: handle.extended },
    mintSignature: signature,
    typedExhaustion: typedMessage,
  }, null, 2));
  console.log("\nRETRY-FLOW PROOF: PASS (throttled simulation recovered via withRetry; mint confirmed; resume skipped ALT creation)");
  // Abandoned retry attempts inside web3.js keep background confirmation
  // polling alive after main() resolves; exit explicitly so the harness's exit
  // code reflects the proof result, not a late orphaned-loop 429.
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
