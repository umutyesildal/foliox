import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, FreshnessBadge } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { truncateAddress } from "@/lib/format";

export const metadata: Metadata = {
  title: "Data providers — FolioX",
  description:
    "Source registry: Backed Finance (xStocks issuer), Jupiter, Yahoo Finance, and the Nasdaq benchmark, with status and freshness.",
};

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";

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

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
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

function RoleBadge({ type }: { type: string }) {
  if (type === "xstock") {
    return (
      <Badge
        variant="outline"
        className="border-[hsl(var(--status-info))]/50 text-[hsl(var(--status-info))]"
      >
        issuer
      </Badge>
    );
  }
  return <Badge variant="outline">{type}</Badge>;
}

/** Health is shown honestly: there is no per-provider health endpoint, so it is "Unknown". */
function HealthBadge({ healthy, label }: { healthy: boolean | null; label: string }) {
  if (healthy === null) {
    return (
      <span
        title="No provider health endpoint is wired yet — status is reported honestly, not fabricated."
        className="inline-flex h-5 items-center rounded-4xl border border-border px-2 font-mono text-xs text-muted-foreground"
      >
        unknown
      </span>
    );
  }
  return (
    <Badge
      variant="outline"
      className={
        healthy
          ? "border-[hsl(var(--status-positive))]/50 text-[hsl(var(--status-positive))]"
          : "border-[hsl(var(--status-caution))]/50 text-[hsl(var(--status-caution))]"
      }
    >
      {label}
    </Badge>
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

  const xstockRows: XStockRow[] = xstocksRes?.data ?? [];
  const fallbackMints: XStockRow[] = (rows.find((r) => r.id === "backed")?.mints ?? []).map((m) => ({
    ticker: m.ticker,
    mint: m.mint ?? "",
    decimals: m.decimals,
    provider: "backed",
    status: m.status,
    priceSource: m.priceSource,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Providers</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Source registry for every quoted figure in FolioX: the xStocks issuer, the token price
            feed, the equity price feed, and the Nasdaq benchmark.
          </p>
        </div>
        <FreshnessBadge
          source={registryReachable ? "registry via /api/v1/providers" : "static registry (API unreachable)"}
          asOf={health?.ts}
        />
      </div>

      {/* Honest backend status — this is the only status we can actually observe. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Backend status</CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            Observed live from <span className="font-mono">/api/v1/health</span>. Per-provider health
            monitoring does not exist yet, so provider rows below report unknown rather than a
            fabricated state.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">API</span>
            <HealthBadge healthy={apiHealthy} label={apiHealthy ? "reachable" : "unreachable"} />
          </span>
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">Indexer DB</span>
            {apiHealthy ? (
              <HealthBadge healthy={dbConnected} label={dbConnected ? "connected" : "DB-less mode"} />
            ) : (
              <HealthBadge healthy={null} label="unknown" />
            )}
          </span>
          {health?.db?.note ? <span className="text-xs text-muted-foreground">{health.db.note}</span> : null}
          {health?.ts ? <FreshnessBadge source="health probe" asOf={health.ts} /> : null}
        </CardContent>
      </Card>

      {/* Source registry table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Source registry</CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            Every quote in the UI names one of these sources. Registry status comes from the backend
            registry listing; it is not a health probe.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Provider</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Provides</TableHead>
                <TableHead>Registry status</TableHead>
                <TableHead>Health</TableHead>
                <TableHead className="pr-4">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const link = p.url ?? PROVIDER_LINKS[p.id];
                return (
                  <TableRow key={p.id} className="h-11 hover:bg-muted/40">
                    <TableCell className="pl-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{p.name}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{p.id}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge type={p.type} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.mints?.length
                        ? p.mints.map((m) => m.ticker).join(" · ")
                        : p.symbol
                          ? `${p.symbol} (benchmark series)`
                          : "equity/index price series"}
                    </TableCell>
                    <TableCell>
                      {p.status ? (
                        <Badge
                          variant="outline"
                          className={
                            p.status === "Active"
                              ? "border-[hsl(var(--status-positive))]/50 text-[hsl(var(--status-positive))]"
                              : "border-[hsl(var(--status-caution))]/50 text-[hsl(var(--status-caution))]"
                          }
                        >
                          {p.status}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <HealthBadge healthy={null} label="unknown" />
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex flex-wrap items-center gap-2">
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
                          <Link href="#xstock-instruments" className="text-xs underline underline-offset-4 hover:text-foreground">
                            Instruments
                          </Link>
                        ) : null}
                        {p.id === "nasdaq" ? (
                          <Link href="/market" className="text-xs underline underline-offset-4 hover:text-foreground">
                            Market view
                          </Link>
                        ) : null}
                        {p.id === "yahoo" || p.id === "jupiter" ? (
                          <Link href="/stock/TSLAx" className="text-xs underline underline-offset-4 hover:text-foreground">
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
        </CardContent>
      </Card>

      {!registryReachable ? (
        <p className="text-xs text-muted-foreground">
          /api/v1/providers was unreachable, so the table shows the app&apos;s static registry
          configuration. Health stays unknown — no status is invented.
        </p>
      ) : null}

      {/* xStock instruments */}
      <Card>
        <CardHeader className="pb-2" id="xstock-instruments">
          <CardTitle className="text-base font-medium">xStock instruments</CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            Token-2022 mints issued by Backed Finance. Each instrument maps to a real equity ticker
            used by the Yahoo feed.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {xstockRows.length === 0 && fallbackMints.length === 0 ? (
            <div className="p-4">
              <EmptyState
                chip="NOT INDEXED"
                title="Instrument list unavailable"
                description="/api/v1/xstocks and the registry mints are unreachable right now, so no mint list is shown."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Ticker</TableHead>
                  <TableHead>Issuer</TableHead>
                  <TableHead>Mint</TableHead>
                  <TableHead>Price source</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">Chart</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(xstockRows.length > 0 ? xstockRows : fallbackMints).map((x) => (
                  <TableRow key={x.ticker} className="h-11 hover:bg-muted/40">
                    <TableCell className="pl-4 font-mono text-sm tabular-nums">{x.ticker}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">Backed Finance</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {x.mint ? truncateAddress(x.mint, 6, 6) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {x.priceSource ?? `jupiter:${x.ticker}`}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link
                        href={`/stock/${x.ticker}`}
                        className="text-xs underline underline-offset-4 hover:text-foreground"
                      >
                        View chart
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="space-y-1 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          xStock tokens are issued by Backed Finance as structured instruments —
          they track the underlying equity but are not the share itself.
        </p>
        <p>LEGAL_REVIEW_REQUIRED: issuer disclosure must be approved by counsel before mainnet.</p>
      </div>
    </div>
  );
}
