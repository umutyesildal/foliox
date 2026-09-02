"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { EmptyState, ErrorState, FreshnessBadge, Skeleton, TableRowSkeleton } from "@/components/states";
import { SiteFooter, WalletButton } from "@/components/shell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAsOf, formatTokenAmount, truncateAddress } from "@/lib/format";
import { LegalReviewTag } from "@/components/create";

const API_BASE = process.env.NEXT_PUBLIC_API || "http://localhost:3001";
/** Basket share mints are fixed 6 decimals, no ScaledUiAmount multiplier. */
const SHARE_MINT_DECIMALS = 6;

interface PortfolioPosition {
  basket: string;
  share_balance: string;
  cost_basis: string;
  updated_at?: string | null;
  nav: { value: string; supply: string; asOf: string } | null;
  estimatedValue: string | null;
  source?: string | null;
  asOf?: string | null;
}

function shareUnits(raw: string): number {
  try {
    return Number(BigInt(raw)) / 10 ** SHARE_MINT_DECIMALS;
  } catch {
    return Number.NaN;
  }
}

/**
 * Portfolio — wallet-gated positions from GET /api/v1/users/:pubkey/portfolio.
 * Every state is honest: no wallet, no positions, indexer down, or real rows
 * with raw values, cost basis and redeem shortcuts. Nothing is fabricated.
 */
export default function PortfolioPage() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();

  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!publicKey) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/users/${publicKey.toBase58()}/portfolio`,
        { cache: "no-store" },
      );
      const payload = (await res.json().catch(() => null)) as
        | { data?: PortfolioPosition[]; source?: string | null; asOf?: string | null; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setPositions([]);
        setStatus("error");
        setError(
          payload?.error?.message ??
            `Indexed positions are unavailable (HTTP ${res.status}).`,
        );
        return;
      }
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      setPositions(rows);
      setSource(payload?.source ?? null);
      setAsOf(payload?.asOf ?? rows.find((row) => row.asOf)?.asOf ?? null);
      setStatus("ready");
    } catch (err) {
      setPositions([]);
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "The portfolio API did not respond. The indexer is convenience only — redeem still works on-chain.",
      );
    }
  }, [publicKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep a light RPC heartbeat so the page reflects reality if the wallet
  // disconnects mid-session (no fabricated rows while offline).
  useEffect(() => {
    if (!connected) setStatus("idle");
  }, [connected]);

  if (!connected || !publicKey) {
    return (
      <div className="mx-auto w-full min-h-[60vh] max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Basket share positions for the connected wallet.
        </p>
        <EmptyState
          className="mt-8"
          chip="NO WALLET"
          title="No wallet connected"
          description="Positions are read from your wallet's basket share balances as indexed by the backend — nothing is shown until a wallet is connected."
          action={<WalletButton />}
          previewLabel="Layout preview — positions table"
          preview={
            <div className="overflow-hidden rounded-md border border-border/60">
              <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] gap-3 border-b border-border/60 bg-muted/40 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                <span>Basket</span>
                <span className="text-right">Shares (units)</span>
                <span className="text-right">Cost basis</span>
                <span className="text-right">Value est.</span>
              </div>
              <div className="flex flex-col gap-2.5 px-3 py-3">
                {Array.from({ length: 3 }, (_, row) => (
                  <div
                    key={row}
                    className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] items-center gap-3"
                  >
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="ml-auto h-4 w-4/5" />
                    <Skeleton className="ml-auto h-4 w-4/5" />
                    <Skeleton className="ml-auto h-4 w-4/5" />
                  </div>
                ))}
              </div>
            </div>
          }
        />
        <p className="mt-6 text-xs leading-5 text-muted-foreground">
          After connecting, positions load with raw share balances, cost basis
          and redeem shortcuts.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
          <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
            {truncateAddress(publicKey.toBase58(), 6, 6)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {source && <FreshnessBadge source={source} asOf={asOf ?? undefined} />}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={status === "loading"}>
            Refresh
          </Button>
        </div>
      </div>

      {status === "loading" && (
        <div className="mt-8" role="status" aria-label="Loading positions">
          <span className="sr-only">Loading positions</span>
          <TableRowSkeleton rows={3} columns={5} label="Loading positions" />
        </div>
      )}

      {status === "error" && (
        <div className="mt-8">
          <ErrorState
            title="Positions unavailable"
            message={error ?? "The portfolio API did not respond."}
            onRetry={() => void load()}
          />
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            The indexer is convenience only — if it is down, mint and redeem
            still work directly against the on-chain programs.
          </p>
        </div>
      )}

      {status === "ready" && positions.length === 0 && (
        <EmptyState
          className="mt-8"
          chip="NOT INDEXED"
          title="No indexed positions for this wallet"
          description="The indexer returned zero user_positions rows — on-chain balances are the source of truth and the indexer never invents rows."
          action={
            <Link
              href="/explore"
              className="rounded-lg bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Browse baskets
            </Link>
          }
          previewLabel="Layout preview — positions table"
          preview={
            <div className="flex flex-col gap-2.5">
              {Array.from({ length: 3 }, (_, row) => (
                <div key={row} className="grid grid-cols-[minmax(0,2fr)_1fr_1fr] items-center gap-3">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="ml-auto h-4 w-4/5" />
                  <Skeleton className="ml-auto h-4 w-1/2" />
                </div>
              ))}
            </div>
          }
        />
      )}

      {status === "ready" && positions.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Basket</TableHead>
                <TableHead className="text-right text-xs">Share balance (raw)</TableHead>
                <TableHead className="text-right text-xs">Shares (units)</TableHead>
                <TableHead className="text-right text-xs">Cost basis (raw)</TableHead>
                <TableHead className="text-right text-xs">Value est. (raw)</TableHead>
                <TableHead className="text-xs">NAV as of</TableHead>
                <TableHead className="text-right text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((position) => (
                <TableRow key={position.basket}>
                  <TableCell>
                    <Link
                      href={`/basket/${position.basket}`}
                      className="font-mono text-xs underline-offset-2 hover:underline"
                    >
                      {truncateAddress(position.basket, 6, 6)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums" title={position.share_balance}>
                    {position.share_balance}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatTokenAmount(shareUnits(position.share_balance), {
                      maximumFractionDigits: 6,
                    })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums" title={position.cost_basis}>
                    {position.cost_basis}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums" title={position.estimatedValue ?? undefined}>
                    {position.estimatedValue ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {position.nav ? (
                      <span className="font-mono tabular-nums">{formatAsOf(position.nav.asOf)}</span>
                    ) : (
                      "no NAV snapshot yet"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/basket/${position.basket}/redeem`}
                      className="rounded-lg border border-border bg-background px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      Redeem
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2 text-xs leading-5 text-muted-foreground">
        <p>
          Raw values are the on-chain truth; share units are raw ÷ 10^6 (share
          mints are fixed 6 decimals with no scaled-UI multiplier — underlying
          xStock multipliers apply inside vault holdings). &ldquo;Value
          est.&rdquo; is balance × latest share_price — a reference, not a
          quote.{" "}
          <LegalReviewTag />
        </p>
        <p>
          RPC {connection.rpcEndpoint.split("//")[1] ?? connection.rpcEndpoint} · positions are
          read-only here; redemption is permissionless on the basket page.
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}
