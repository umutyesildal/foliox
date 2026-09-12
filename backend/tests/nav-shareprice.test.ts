/**
 * nav-shareprice.test.ts — the /nav/history share-price contract: the bucketed
 * variants expose per-bucket share_price open/close aggregates (raw variants
 * already selected the column), the handler passes share_price through
 * additively, and rows lacking share_price (pre-creation snapshots) never
 * crash. Mirrors the fake PgLike + direct-handler-call pattern of
 * waveb-nav-api.test.ts. No real Postgres.
 */
import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";

import { navHistory } from "../src/api/server";
import type { PgLike } from "../src/db/client";

// --- fakes (mirrors waveb-nav-api.test.ts) -----------------------------------

type SqlRoute = { match: string | RegExp; rows: unknown[]; rowCount?: number };

/** PgLike test double that routes canned rows by SQL fragment and records calls. */
function fakeDb(routes: SqlRoute[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    calls,
    query: async (sql: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> => {
      calls.push({ sql, values });
      for (const r of routes) {
        if (typeof r.match === "string" ? sql.includes(r.match) : r.match.test(sql)) {
          return { rows: r.rows.map((x) => ({ ...x })), rowCount: r.rowCount ?? r.rows.length };
        }
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PgLike & { calls: Array<{ sql: string; values?: unknown[] }> };
}

const BASKET = new PublicKey(Buffer.alloc(32, 1)).toBase58();
const EXISTS = { match: "FROM baskets WHERE pubkey", rows: [{ 1: 1 }] };

// ============================================================================

describe("navHistory — share_price contract", () => {
  it("raw variant SQL selects share_price::text AS share_price (and only the static SQL ran)", async () => {
    const db = fakeDb([EXISTS]);
    const out = await navHistory(db, BASKET, { from: "2026-09-01T00:00:00Z" });
    expect(out.status).toBe(200);

    const historyCall = db.calls.find((c) => c.sql.includes("FROM nav_snapshots"));
    expect(historyCall).toBeDefined();
    expect(historyCall!.sql).toContain("share_price::text AS share_price");
    // provenance still stamped per row
    const payload = out.payload as { data: Array<Record<string, unknown>>; source: string };
    expect(payload.source).toBe("onchain-indexed");
  });

  it("bucketed variant SQL adds share_price open/close aggregates next to the untouched nav OHLC columns", async () => {
    const db = fakeDb([EXISTS]);
    const out = await navHistory(db, BASKET, { interval: "1h" });
    expect(out.status).toBe(200);
    expect((out.payload as { interval: string }).interval).toBe("1h");

    const historyCall = db.calls.find((c) => c.sql.includes("date_bin"));
    expect(historyCall).toBeDefined();
    expect(historyCall!.sql).toContain("(array_agg(share_price ORDER BY ts))[1]::text AS share_price_open");
    expect(historyCall!.sql).toContain("(array_agg(share_price ORDER BY ts DESC))[1]::text AS share_price");
    // existing nav OHLC shape untouched for other consumers
    expect(historyCall!.sql).toContain("AS open");
    expect(historyCall!.sql).toContain("AS close");
    expect(historyCall!.sql).toContain("AS low");
    expect(historyCall!.sql).toContain("AS high");
  });

  it("handler passes share_price through in rows; rows without it (old snapshots) do not crash", async () => {
    const db = fakeDb([
      EXISTS,
      {
        match: "FROM nav_snapshots",
        rows: [
          { ts: "2026-09-01T11:00:00Z", nav: "150000", supply: "1000000", share_price: "0.155", price_source: {} },
          { ts: "2026-09-01T10:00:00Z", nav: "0", supply: "0" }, // legacy row, no share_price
        ],
      },
    ]);
    const out = await navHistory(db, BASKET, { from: "2026-09-01T00:00:00Z" });
    expect(out.status).toBe(200);
    const payload = out.payload as { data: Array<Record<string, unknown>>; count: number };
    expect(payload.count).toBe(2);
    expect(payload.data[0].share_price).toBe("0.155");
    expect(payload.data[0].source).toBe("onchain-indexed");
    // legacy row stays present (the frontend filters it — the API never drops data)
    expect("share_price" in payload.data[1]).toBe(false);
  });

  it("bucketed handler rows carry share_price_open + share_price from the aggregate columns", async () => {
    const db = fakeDb([
      EXISTS,
      {
        match: "date_bin",
        rows: [
          {
            bucket: "2026-09-01T11:00:00Z",
            open: "150000", close: "155000", low: "150000", high: "155000", avg: "152500",
            supply: "1000000", share_price_open: "0.15", share_price: "0.155", points: 2,
          },
        ],
      },
    ]);
    const out = await navHistory(db, BASKET, { interval: "1h" });
    expect(out.status).toBe(200);
    const row = (out.payload as { data: Array<Record<string, unknown>> }).data[0];
    expect(row.share_price_open).toBe("0.15");
    expect(row.share_price).toBe("0.155");
  });
});
