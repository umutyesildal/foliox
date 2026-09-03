"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorState, EmptyState, FreshnessBadge, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ChangeValue } from "@/components/stocks/change-value";
import { formatUsd, truncateAddress } from "@/lib/format";

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

/** Numeric field as served by the indexer: Postgres numeric serialized as text. */
type Numeric = string | number | null | undefined;

/** Defensive shape — the list feed carries no constituents today (see compositionOf). */
interface ConstituentLike {
  ticker?: unknown;
  symbol?: unknown;
  name?: unknown;
  mint?: unknown;
  weight?: unknown;
  weight_bps?: unknown;
  weightBps?: unknown;
  weight_pct?: unknown;
  weightPct?: unknown;
}

interface BasketRow {
  pubkey: string;
  creator?: string | null;
  /** Off-chain name/description JSON from the indexer list feed (backend selects metadata_json). */
  metadata_json?: string | Record<string, unknown> | null;
  /** Mint pubkeys (indexer feed, positional with weights_bps) or richer objects. */
  constituents?: (ConstituentLike | string)[] | null;
  weights_bps?: Numeric[] | null;
  num_constituents?: Numeric;
  share_mint?: string | null;
  nav?: Numeric;
  supply?: Numeric;
  share_price?: Numeric;
  return_24h?: Numeric;
  return_7d?: Numeric;
  return_30d?: Numeric;
  holders?: number | null;
  mint_count?: number | null;
  source?: string | null;
  asOf?: string | null;
  nav_as_of?: string | null;
  refreshed_at?: string | null;
}

interface BasketsPayload {
  data?: BasketRow[];
  count?: number;
  source?: string | null;
  asOf?: string | null;
  note?: string;
  error?: { code?: string; message?: string };
}

interface YahooCandle {
  ts: number;
  close: number;
}

interface OverviewSeries {
  symbol: string;
  first: number;
  last: number;
  changePct: number;
  candles: YahooCandle[];
}

interface OverviewPayload {
  data?: OverviewSeries[];
  range?: string;
}

/** Benchmark returns (%) computed from SPY daily closes; null windows mean no comparison. */
interface Bench {
  d24: number | null;
  d30: number | null;
}

type SortKey = "popular" | "return_24h" | "return_30d" | "vs_spy";

function num(v: Numeric): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asOfOf(b: BasketRow): string | null {
  return b.asOf ?? b.nav_as_of ?? b.refreshed_at ?? null;
}

function metaObj(mj: BasketRow["metadata_json"]): Record<string, unknown> | null {
  if (!mj) return null;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
}

/** Basket display name from metadata_json.name when present, e.g. "Tech Duo". */
function nameOf(b: BasketRow): string | null {
  const name = metaObj(b.metadata_json)?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** Ticker-ish symbol for a constituent; short mint as last resort. */
function constituentTicker(c: ConstituentLike): string | null {
  for (const key of [c.ticker, c.symbol]) {
    if (typeof key === "string" && key.trim()) return key.trim();
  }
  if (typeof c.name === "string" && c.name.trim()) return c.name.trim();
  if (typeof c.mint === "string" && c.mint) return truncateAddress(c.mint, 4, 4);
  return null;
}

/** Weight as a percent number; accepts pct, bps, or an ambiguous raw fraction. */
function constituentWeightPct(c: ConstituentLike): number | null {
  const pct = num(c.weight_pct as Numeric) ?? num(c.weightPct as Numeric);
  if (pct !== null) return pct;
  const bps = num(c.weight_bps as Numeric) ?? num(c.weightBps as Numeric);
  if (bps !== null) return bps / 100;
  const w = num(c.weight as Numeric);
  if (w === null) return null;
  return w <= 100 ? w : w / 100;
}

const MAX_COMPOSITION_PARTS = 4;

/**
 * Composition string for the card's secondary line, e.g. "AAPLx 50 · TSLAx 50".
 * Mint-pubkey constituents are resolved through the whitelist ticker map;
 * falls back to metadata constituents, then null (card shows name/pubkey).
 */
function compositionOf(b: BasketRow, mintTickers: Map<string, string>): string | null {
  const parts: string[] = [];
  const rawList = Array.isArray(b.constituents) ? b.constituents : null;
  if (rawList && rawList.length > 0) {
    const weights = Array.isArray(b.weights_bps) ? b.weights_bps : null;
    rawList.forEach((c, i) => {
      const mint = typeof c === "string" ? c : typeof c.mint === "string" ? c.mint : null;
      const ticker =
        (typeof c === "object" && c !== null ? constituentTicker(c) : null) ??
        (mint ? mintTickers.get(mint) ?? null : null) ??
        (mint ? truncateAddress(mint, 4, 4) : null);
      if (!ticker) return;
      const bps = weights ? num(weights[i]) : null;
      parts.push(bps !== null ? `${ticker} ${Math.round(bps / 100)}` : ticker);
    });
  } else {
    let list: ConstituentLike[] | null = null;
    const metaConstituents = metaObj(b.metadata_json)?.constituents;
    if (Array.isArray(metaConstituents)) list = metaConstituents as ConstituentLike[];
    for (const c of list ?? []) {
      const ticker = constituentTicker(c);
      if (!ticker) continue;
      const weight = constituentWeightPct(c);
      parts.push(weight !== null ? `${ticker} ${Math.round(weight)}` : ticker);
    }
  }
  if (parts.length === 0) return null;
  const shown = parts.slice(0, MAX_COMPOSITION_PARTS).join(" · ");
  return parts.length > MAX_COMPOSITION_PARTS
    ? `${shown} · +${parts.length - MAX_COMPOSITION_PARTS}`
    : shown;
}

/** Basket return minus SPY return over the same window. Gray +/-, sign always shown. */
function DeltaCell({ value, window: win }: { value: number | null; window: "24h" | "30d" }) {
  if (value === null) {
    return (
      <span
        className="text-muted-foreground"
        title={`No ${win} comparison — needs both the basket ${win} return and the SPY ${win} close.`}
      >
        —
      </span>
    );
  }
  const positive = value >= 0;
  return (
    <span
      className={`font-mono text-xs tabular-nums ${
        positive ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {positive ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

interface BasketCardProps {
  b: BasketRow;
  bench: Bench | null;
  showVs24: boolean;
  mintTickers: Map<string, string>;
}

/**
 * One basket in the /explore grid — same card treatment as /stocks:
 * whole card is a link to /basket/[pubkey], name headline with the mono
 * composition as the secondary line, big mono share price, AUM muted,
 * bottom row 24h change + vs SPY delta.
 */
function BasketCard({ b, bench, showVs24, mintTickers }: BasketCardProps) {
  const change = num(b.return_24h);
  const r30 = num(b.return_30d);
  const d24 = change !== null && bench?.d24 != null ? change - bench.d24 : null;
  const d30 = r30 !== null && bench?.d30 != null ? r30 - bench.d30 : null;
  const sharePrice = num(b.share_price);
  const nav = num(b.nav);
  /** No NAV/price indexed yet — muted price plus an explicit "not indexed" chip. */
  const unavailable = sharePrice === null;
  const name = nameOf(b);
  const composition = compositionOf(b, mintTickers);
  const headline = name ?? composition ?? truncateAddress(b.pubkey, 6, 4);

  return (
    <Link
      href={`/basket/${b.pubkey}`}
      title={`Open basket ${b.pubkey}`}
      className="group flex flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span
            className="block break-words text-sm font-medium tracking-tight text-foreground"
            title={b.pubkey}
          >
            {headline}
          </span>
          {name && composition ? (
            <span className="mt-1 block break-words font-mono text-xs text-muted-foreground">
              {composition}
            </span>
          ) : null}
        </div>
        {unavailable ? (
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            not indexed
          </span>
        ) : null}
      </div>

      <span
        className={`mt-4 font-mono text-2xl tabular-nums ${
          unavailable ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {sharePrice !== null ? formatUsd(sharePrice) : "—"}
      </span>
      <span className="mt-0.5 text-xs text-muted-foreground">
        AUM {nav !== null ? formatUsd(nav, { maximumFractionDigits: 0 }) : "—"}
      </span>

      <div className="mt-auto pt-4">
        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">24h</span>
            <ChangeValue changePct={change} />
          </span>
          {showVs24 ? (
            <span className="flex flex-col items-end gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                vs SPY
              </span>
              <DeltaCell value={d24} window="24h" />
            </span>
          ) : bench ? (
            <span className="flex flex-col items-end gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                vs SPY 30d
              </span>
              <DeltaCell value={d30} window="30d" />
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export default function ExploreClient() {
  const [baskets, setBaskets] = useState<BasketRow[]>([]);
  const [payloadMeta, setPayloadMeta] = useState<{ asOf: string | null } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorInfo, setErrorInfo] = useState<{ message: string; code?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [bench, setBench] = useState<Bench | null>(null);
  const [mintTickers, setMintTickers] = useState<Map<string, string>>(new Map());

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("popular");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setErrorInfo(null);

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/baskets?limit=100`, {
          signal: controller.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const payload = (await res.json()) as BasketsPayload;
        if (!res.ok) {
          setErrorInfo({
            message: payload?.error?.message ?? `API responded with HTTP ${res.status}`,
            code: payload?.error?.code,
          });
          setStatus("error");
          return;
        }
        setBaskets(payload.data ?? []);
        setPayloadMeta({ asOf: payload.asOf ?? null });
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setErrorInfo({
          message: err instanceof Error ? err.message : "Could not reach the basket API.",
        });
        setStatus("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadKey]);

  // Whitelist mint→ticker map for card composition strings — fetched once, optional.
  useEffect(() => {
    const controller = new AbortController();

    async function loadTickers() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/whitelist`, {
          signal: controller.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          data?: { mint?: string; ticker?: string; price_source?: string }[];
        };
        const map = new Map<string, string>();
        for (const row of payload.data ?? []) {
          if (typeof row.mint !== "string" || !row.mint) continue;
          const fromField = typeof row.ticker === "string" ? row.ticker.trim() : "";
          const fromSource = typeof row.price_source === "string" ? row.price_source.split(":").pop() ?? "" : "";
          const ticker = fromField || fromSource;
          if (ticker) map.set(row.mint, ticker);
        }
        setMintTickers(map);
      } catch {
        // composition falls back to metadata name / mint fragments
      }
    }

    void loadTickers();
    return () => controller.abort();
  }, []);

  // Benchmark series (SPY daily closes via the market overview feed) — fetched once.
  // When unavailable, every vs-SPY affordance is hidden; no fabricated zeros.
  useEffect(() => {
    const controller = new AbortController();

    async function loadBench() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/market/overview?range=1mo`, {
          signal: controller.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          setBench(null);
          return;
        }
        const payload = (await res.json()) as OverviewPayload;
        const spy = payload.data?.find((s) => s.symbol === "SPY");
        const candles = spy?.candles ?? [];
        if (candles.length < 2) {
          setBench(null);
          return;
        }
        const last = candles[candles.length - 1]?.close;
        const prev = candles[candles.length - 2]?.close;
        const first = candles[0]?.close;
        const d24 = prev ? ((last - prev) / prev) * 100 : null;
        const d30 = first ? ((last - first) / first) * 100 : null;
        setBench(d24 === null && d30 === null ? null : { d24, d30 });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setBench(null);
      }
    }

    void loadBench();
    return () => controller.abort();
  }, []);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const showVs24 = bench?.d24 != null;
  const showVs30 = bench?.d30 != null;

  const SORT_OPTIONS: { key: SortKey; label: string }[] = useMemo(() => {
    const base: { key: SortKey; label: string }[] = [
      { key: "popular", label: "Most popular" },
      { key: "return_24h", label: "Best 24h" },
      { key: "return_30d", label: "Best 30d" },
    ];
    if (showVs24 || showVs30) base.push({ key: "vs_spy", label: "vs SPY" });
    return base;
  }, [showVs24, showVs30]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = baskets.filter((b) => {
      if (!q) return true;
      const name = nameOf(b)?.toLowerCase() ?? "";
      const composition = compositionOf(b, mintTickers)?.toLowerCase() ?? "";
      return (
        b.pubkey.toLowerCase().includes(q) ||
        name.includes(q) ||
        composition.includes(q) ||
        (b.creator ?? "").toLowerCase().includes(q) ||
        (b.share_mint ?? "").toLowerCase().includes(q)
      );
    });

    const delta30 = (b: BasketRow): number | null => {
      const r = num(b.return_30d);
      return r !== null && bench?.d30 != null ? r - bench.d30 : null;
    };
    const delta24 = (b: BasketRow): number | null => {
      const r = num(b.return_24h);
      return r !== null && bench?.d24 != null ? r - bench.d24 : null;
    };
    const bestDelta = (b: BasketRow): number | null => delta30(b) ?? delta24(b);

    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case "return_24h":
          return (num(b.return_24h) ?? -Infinity) - (num(a.return_24h) ?? -Infinity);
        case "return_30d":
          return (num(b.return_30d) ?? -Infinity) - (num(a.return_30d) ?? -Infinity);
        case "vs_spy":
          return (bestDelta(b) ?? -Infinity) - (bestDelta(a) ?? -Infinity);
        case "popular":
        default:
          // Most popular: holders first, AUM as tiebreaker.
          return (
            (b.holders ?? -1) - (a.holders ?? -1) ||
            (num(b.nav) ?? -1) - (num(a.nav) ?? -1)
          );
      }
    });
    return rows;
  }, [baskets, query, sortKey, bench]);

  const hasBaskets = baskets.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Baskets</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Community-made strategy baskets — every creator and every return is on-chain.
          </p>
        </div>
        <Button render={<Link href="/create" />}>Create basket</Button>
      </div>

      {status === "loading" ? (
        <div
          role="status"
          aria-label="Loading baskets"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} aria-hidden="true" className="rounded-lg border border-border bg-card p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-4 h-7 w-24" />
              <Skeleton className="mt-1.5 h-3 w-16" />
              <Skeleton className="mt-6 h-3 w-full" />
            </div>
          ))}
        </div>
      ) : status === "error" ? (
        <ErrorState
          title="Baskets unavailable"
          message={
            errorInfo
              ? `${errorInfo.code ? `${errorInfo.code}: ` : ""}${errorInfo.message}`
              : "Could not reach the basket API."
          }
          onRetry={retry}
        />
      ) : !hasBaskets ? (
        <EmptyState
          chip="NOT INDEXED"
          title="No baskets indexed yet"
          description="The backend returns an empty list until baskets are created and indexed — nothing here is fabricated."
          action={
            <Button render={<Link href="/create" />} size="sm">
              Create the first basket
            </Button>
          }
          previewLabel="Layout preview — baskets grid"
          preview={
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className="rounded-lg border border-border/60 bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                  <Skeleton className="mt-4 h-6 w-20" />
                  <Skeleton className="mt-2 h-3 w-16" />
                  <Skeleton className="mt-6 h-3 w-full" />
                </div>
              ))}
            </div>
          }
        />
      ) : (
        <>
          {/* Controls — search / sort, client-side over the fetched list. FreshnessBadge keeps the honest as-of; no provenance source line. */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <input
              id="explore-search"
              type="search"
              aria-label="Search baskets"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search baskets"
              className="h-9 max-md:h-10 w-full max-w-sm rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="explore-sort" className="text-xs font-medium text-muted-foreground">
                  Sort by
                </label>
                <select
                  id="explore-sort"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="h-9 max-md:h-10 w-full max-w-[12rem] rounded-md border border-border bg-card px-2 text-sm text-foreground outline-none focus:border-ring"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {payloadMeta ? (
                <FreshnessBadge
                  source={payloadMeta.asOf ? "as of" : ""}
                  asOf={payloadMeta.asOf ?? undefined}
                />
              ) : null}
            </div>
          </div>

          {/* Grid only — same responsive layout as /stocks (1 / 2 / 3-4 columns). */}
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No basket matches the current search.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((b) => (
                <BasketCard key={b.pubkey} b={b} bench={bench} showVs24={showVs24} mintTickers={mintTickers} />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {visible.length} of {baskets.length} baskets shown
            </span>
            {bench ? (
              <span>vs SPY = basket return − SPY return (Yahoo Finance daily closes) over the matching window.</span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
