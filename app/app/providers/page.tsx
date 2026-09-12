import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, FreshnessBadge } from "@/components/states";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { truncateAddress } from "@/lib/format";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Data providers — Basalt",
  description:
    "Source registry: Backed Finance (xStocks issuer), Jupiter, Yahoo Finance, and the Nasdaq benchmark, with status and freshness.",
};

interface ProviderMint {
  ticker: string;
  mint?: string;
  decimals?: number;
  status?: string;
  priceSource?: string;
}

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  url?: string;
  symbol?: string;
  mints?: ProviderMint[] | null;
  status?: string;
}

interface ProvidersPayload {
  data?: ProviderRow[];
}

interface XStockRow {
  ticker: string;
  mint: string;
  yahooSymbol?: string;
  decimals?: number;
  provider?: string;
  status?: string;
  priceSource?: string;
}

interface HealthPayload {
  ok?: boolean;
  ts?: string;
  version?: string;
  db?: { connected?: boolean; note?: string; degraded?: boolean } | null;
  subsystems?: {
    indexer?: { enabled?: boolean; running?: boolean };
    navEngine?: { enabled?: boolean; running?: boolean };
    feeCrank?: { enabled?: boolean; running?: boolean };
  } | null;
}

/** Well-known links for the static registry rows (configuration, not health data). */
const PROVIDER_LINKS: Record<string, string> = {
  backed: "https://backed.fi",
  jupiter: "https://price.jup.ag/v6/price",
  yahoo: "https://finance.yahoo.com",
  nasdaq: "https://www.nasdaq.com/market-activity/index/qx",
};

const STATIC_REGISTRY: ProviderRow[] = [
  { id: "backed", name: "Backed Finance", type: "xstock" },
  { id: "jupiter", name: "Jupiter Price v6", type: "price" },
  { id: "yahoo", name: "Yahoo Finance", type: "price" },
  { id: "nasdaq", name: "Nasdaq Benchmark (QQQ)", type: "index", symbol: "QQQ" },
];

const ROLE_LABEL: Record<string, string> = {
  xstock: "issuer",
  price: "price feed",
  index: "benchmark",
};

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await apiFetch(path, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function StatusDot({ state }: { state: "on" | "off" | "unknown" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        state === "on" && "bg-foreground",
        state === "off" && "border border-muted-foreground/60 bg-transparent",
        state === "unknown" && "bg-border",
      )}
    />
  );
}

function StatusItem({ state, label }: { state: "on" | "off" | "unknown"; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs">
      <StatusDot state={state} />
      <span className={state === "on" ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </span>
  );
}

/** Quiet bordered mono chip — health is unknown until monitoring exists. */
function UnknownChip() {
  return (
    <span className="inline-flex h-5 items-center rounded-sm border border-border px-2 font-mono text-xs text-muted-foreground">
      unknown
    </span>
  );
}

export default async function ProvidersPage() {
  const [providersRes, xstocksRes, healthRes] = await Promise.all([
    getJson<ProvidersPayload>("/api/v1/providers"),
    getJson<{ data?: XStockRow[] }>("/api/v1/xstocks"),
    getJson<HealthPayload>("/api/v1/health"),
  ]);

  const registryReachable = providersRes?.data != null;
  const rows = registryReachable ? (providersRes?.data as ProviderRow[]) : STATIC_REGISTRY;
  const health = healthRes;
  const apiHealthy = healthRes !== null;
  const dbConnected = health?.db?.connected === true;
  const dbDegraded = health?.db?.degraded === true;

  const xstockRows: XStockRow[] = xstocksRes?.data ?? [];
  const fallbackMints: XStockRow[] = (rows.find((r) => r.id === "backed")?.mints ?? []).map((m) => ({
    ticker: m.ticker,
    mint: m.mint ?? "",
    decimals: m.decimals,
    provider: "backed",
    status: m.status,
    priceSource: m.priceSource,
  }));

  const dbState: "on" | "off" | "unknown" = !apiHealthy ? "unknown" : dbConnected ? "on" : "off";
  const dbLabel = !apiHealthy ? "DB unknown" : dbDegraded ? "DB degraded" : dbConnected ? "DB connected" : "DB-less";
  const indexerState: "on" | "off" | "unknown" =
    !apiHealthy || health?.subsystems?.indexer == null
      ? "unknown"
      : health.subsystems.indexer.running === true
        ? "on"
        : "off";

  return (
    <div>
      <header className="pb-10">
        <h1 className="font-display text-3xl font-semibold">Providers</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Every quoted figure names its source — issuer, token price, equity price, benchmark.
        </p>
      </header>

      {/* Backend status — observed live from /api/v1/health. */}
      <section aria-labelledby="backend-status" className="border-t border-border py-10">
        <h2 id="backend-status" className="font-display text-sm font-medium">
          Backend status
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusItem
            state={apiHealthy ? "on" : "off"}
            label={apiHealthy ? "API reachable" : "API unreachable"}
          />
          <StatusItem state={dbState} label={dbLabel} />
          <StatusItem
            state={indexerState}
            label={!apiHealthy ? "Indexer unknown" : indexerState === "on" ? "Indexer on" : "Indexer off"}
          />
          {apiHealthy && health?.ts ? <FreshnessBadge source="live" asOf={health.ts} /> : null}
        </div>
        {apiHealthy && indexerState === "off" ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Indexer offline — basket pages stay empty.
          </p>
        ) : null}
      </section>

      {/* Source registry */}
      <section aria-labelledby="source-registry" className="border-t border-border py-10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 id="source-registry" className="font-display text-sm font-medium">
            Source registry
          </h2>
          <FreshnessBadge
            source={registryReachable ? "registry · /api/v1/providers" : "static registry"}
          />
        </div>
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Provider</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Provides</TableHead>
                <TableHead>
                  <span title="Provider health shows unknown until monitoring exists.">Health</span>
                </TableHead>
                <TableHead className="pr-4">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const link = p.url ?? PROVIDER_LINKS[p.id];
                return (
                  <TableRow key={p.id} className="h-11 hover:bg-muted/40">
                    <TableCell className="pl-4 text-sm font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ROLE_LABEL[p.type] ?? p.type}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.mints?.length
                        ? p.mints.map((m) => m.ticker).join(" · ")
                        : p.symbol
                          ? `${p.symbol} benchmark series`
                          : "price series"}
                    </TableCell>
                    <TableCell>
                      <UnknownChip />
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex flex-wrap items-center gap-3">
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-xs underline underline-offset-4 hover:text-foreground"
                          >
                            Website
                          </a>
                        ) : null}
                        {p.id === "backed" ? (
                          <Link
                            href="#xstock-instruments"
                            className="text-xs underline underline-offset-4 hover:text-foreground"
                          >
                            Instruments
                          </Link>
                        ) : null}
                        {p.id === "nasdaq" ? (
                          <Link
                            href="/market"
                            className="text-xs underline underline-offset-4 hover:text-foreground"
                          >
                            Market view
                          </Link>
                        ) : null}
                        {p.id === "yahoo" || p.id === "jupiter" ? (
                          <Link
                            href="/stock/TSLAx"
                            className="text-xs underline underline-offset-4 hover:text-foreground"
                          >
                            Example chart
                          </Link>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* xStock instruments */}
      <section aria-labelledby="xstock-instruments" className="border-t border-border py-10">
        <h2 id="xstock-instruments" className="font-display text-sm font-medium">
          xStock instruments
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          Token-2022 mints issued by Backed Finance — structured instruments, not direct equity.
        </p>
        <div className="mt-4">
          {xstockRows.length === 0 && fallbackMints.length === 0 ? (
            <EmptyState
              chip="NOT INDEXED"
              title="Instrument list unavailable"
              description="/api/v1/xstocks and the registry mints are unreachable right now."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Ticker</TableHead>
                  <TableHead>Issuer</TableHead>
                  <TableHead>Mint</TableHead>
                  <TableHead className="text-right">Decimals</TableHead>
                  <TableHead className="pr-4">Price source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(xstockRows.length > 0 ? xstockRows : fallbackMints).map((x) => (
                  <TableRow key={x.ticker} className="h-11 hover:bg-muted/40">
                    <TableCell className="pl-4 font-mono text-sm tabular-nums">{x.ticker}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Backed Finance</TableCell>
                    <TableCell>
                      {x.mint ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {truncateAddress(x.mint, 6, 6)}
                          </span>
                          <CopyButton value={x.mint} label={`Copy ${x.ticker} mint`} />
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {x.decimals ?? "—"}
                    </TableCell>
                    <TableCell className="pr-4 font-mono text-xs text-muted-foreground">
                      {x.priceSource ?? `jupiter:${x.ticker}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}
