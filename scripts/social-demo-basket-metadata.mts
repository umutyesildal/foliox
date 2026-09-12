/**
 * Social demo overlay — basket metadata backfill (devnet, foliox_devnet).
 *
 * The home demo overlay (NEXT_PUBLIC_HOME_DEMO=1) links its demo baskets at
 * the three REAL indexed devnet baskets. Those baskets were created without
 * off-chain metadata (baskets.metadata_json IS NULL), so /explore, the basket
 * detail pages and the demo band would disagree on names. This script writes
 * a metadata blob shaped exactly like the app parses it (same shape as
 * scripts/createBasket.ts METADATA_BLOB: {name, symbol, version,
 * constituents, note}) onto each real basket, carrying the demo names:
 *
 *   CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo → "Foundry Tech" (FTB)
 *   78jbGZHDiH1jSdctS9bxVkKQgNzuzt1nCX9DiimyYLir → "Index Plus"   (IPB)
 *   9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg → "Mag7 Vector"  (M7V)
 *
 * constituents + weight_bps are COPIED from the live baskets row every run
 * (symbols resolved through whitelisted_mints.price_source "mock:<slug>"
 * labels — the mock xStocks convention, e.g. NVDAx) and never invented here,
 * so the blob always reflects what is actually in each vault.
 *
 * metadata_hash is deliberately NOT touched: it is the on-chain sha256
 * pointer of the original create_basket blob; this JSON is the display-only
 * off-chain copy the API serves alongside it.
 *
 * Idempotent: re-running produces the identical blob (an unchanged row is
 * detected and the UPDATE is skipped).
 *
 * Run (DATABASE_URL comes from the devnet env file — foliox_devnet):
 *   set -a; . backend/.env.devnet; set +a; npx tsx scripts/social-demo-basket-metadata.mts
 */

import pg from "pg";

const TARGETS = [
  { pubkey: "CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo", name: "Foundry Tech", symbol: "FTB" },
  { pubkey: "78jbGZHDiH1jSdctS9bxVkKQgNzuzt1nCX9DiimyYLir", name: "Index Plus", symbol: "IPB" },
  { pubkey: "9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg", name: "Mag7 Vector", symbol: "M7V" },
] as const;

const VERSION = "demo-social-2026-09-12";
const NOTE = "demo metadata — social demo overlay, 2026-09-12";

/** "mock:nvda" → "NVDAx" (createBasket LADDER naming); null when not a mock label. */
function symbolFromPriceSource(priceSource: string | null): string | null {
  if (!priceSource || !priceSource.startsWith("mock:")) return null;
  const slug = priceSource.slice("mock:".length).trim();
  return slug ? `${slug.toUpperCase()}x` : null;
}

/** Key-order-independent JSON string (jsonb does not preserve key order). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Summarize a metadata_json (or null) for the before/after lines. */
function describeMetadata(mj: unknown): string {
  if (mj === null || mj === undefined) return "NULL (no off-chain metadata)";
  const obj = (typeof mj === "object" ? mj : {}) as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name : "?";
  const symbol = typeof obj.symbol === "string" ? obj.symbol : "?";
  const version = typeof obj.version === "string" ? obj.version : "?";
  const n = Array.isArray(obj.constituents) ? obj.constituents.length : "?";
  return `name=${name} symbol=${symbol} version=${version} constituents=${n}`;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set — source the devnet env first: set -a; . backend/.env.devnet; set +a; npx tsx scripts/social-demo-basket-metadata.mts",
    );
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // BEFORE — current metadata per target basket.
  const before = await client.query(
    `SELECT pubkey, metadata_json, metadata_hash, constituents, weights_bps
       FROM baskets WHERE pubkey = ANY($1::text[]) ORDER BY pubkey`,
    [TARGETS.map((t) => t.pubkey)],
  );
  const beforeByPubkey = new Map(before.rows.map((r) => [r.pubkey as string, r]));
  if (beforeByPubkey.size !== TARGETS.length) {
    const missing = TARGETS.filter((t) => !beforeByPubkey.has(t.pubkey)).map((t) => t.pubkey);
    await client.end();
    throw new Error(`target basket(s) not indexed in this DB: ${missing.join(", ")}`);
  }
  console.log("--- BEFORE ---");
  for (const t of TARGETS) {
    const row = beforeByPubkey.get(t.pubkey)!;
    console.log(`${t.pubkey}  ${describeMetadata(row.metadata_json)}  (metadata_hash ${row.metadata_hash})`);
  }

  // Mint → display symbol map from the whitelist mock labels.
  const mints = await client.query(`SELECT mint, price_source FROM whitelisted_mints`);
  const symbolByMint = new Map(
    mints.rows.map((r) => [r.mint as string, symbolFromPriceSource(r.price_source as string | null)]),
  );

  console.log("--- UPDATE ---");
  for (const t of TARGETS) {
    const row = beforeByPubkey.get(t.pubkey)!;
    const mintList = row.constituents as string[];
    const bpsList = row.weights_bps as number[];
    if (mintList.length !== bpsList.length) {
      throw new Error(`${t.pubkey}: constituents/weights_bps length mismatch (${mintList.length} vs ${bpsList.length})`);
    }
    const constituents = mintList.map((mint, i) => ({
      symbol: symbolByMint.get(mint) ?? mint,
      weight_bps: bpsList[i],
    }));
    const blob = {
      name: t.name,
      symbol: t.symbol,
      version: VERSION,
      constituents,
      note: NOTE,
    };
    const serialized = JSON.stringify(blob);

    // Idempotency: skip the write when the row already carries this blob
    // (compared canonically — jsonb does not preserve JSON key order).
    const existing = row.metadata_json === null ? null : canonicalJson(row.metadata_json);
    if (existing !== null && existing === canonicalJson(blob)) {
      console.log(`${t.pubkey}  already carries the target blob — no-op`);
      continue;
    }
    await client.query(`UPDATE baskets SET metadata_json = $1::jsonb WHERE pubkey = $2`, [
      serialized,
      t.pubkey,
    ]);
    console.log(`${t.pubkey}  metadata_json updated (${describeMetadata(blob)}; metadata_hash untouched)`);
  }

  // AFTER — re-read and print the resulting state.
  const after = await client.query(
    `SELECT pubkey, metadata_json, metadata_hash FROM baskets WHERE pubkey = ANY($1::text[]) ORDER BY pubkey`,
    [TARGETS.map((t) => t.pubkey)],
  );
  console.log("--- AFTER ---");
  for (const r of after.rows) {
    console.log(`${r.pubkey}  ${describeMetadata(r.metadata_json)}  (metadata_hash ${r.metadata_hash})`);
  }

  await client.end();
  console.log("DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
