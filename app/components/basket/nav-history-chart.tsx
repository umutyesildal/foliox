"use client";

import { useMemo } from "react";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import type { TooltipRow } from "@/components/charts/tooltip/tooltip-content";
import { numericToNumber, type NavHistoryRow } from "@/components/basket/basket-api";

/** Ethereal fill ceiling for the chart-1 area (charts only, per style contract). */
const NAV_FILL_OPACITY = 0.06;

/**
 * Adaptive USD formatting for the share-price axis/tooltip: 3 decimals while
 * the whole visible window is under $1 (genesis share prices ~$0.36), 2 after.
 */
function makeUsdFormatter(maxValue: number): (value: number) => string {
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: maxValue > 0 && maxValue < 1 ? 3 : 2,
  });
  return (value: number) => fmt.format(value);
}

/**
 * Share-price history AreaChart (official Bklit AreaChart composition —
 * see components/charts/*). Plots nav_snapshots.share_price — USD per share,
 * the performance-relevant number that matches the "Share price" hero metric —
 * NOT total NAV (absolute AUM), whose supply growth is not a return. Points
 * without a usable share_price (pre-creation zero-supply snapshots) are
 * dropped, so the create-time 0→AUM cliff disappears naturally. Raw snapshot
 * series from /baskets/:pubkey/nav/history; no interpolation, no fabricated
 * points. Fewer than two points renders as a quiet centered note so the hero
 * card keeps a stable height instead of collapsing.
 */
export function NavHistoryChart({
  rows,
  fitYDomain,
}: {
  rows: NavHistoryRow[];
  /** Tight y-domain around the visible window (stock-page chart treatment). */
  fitYDomain?: boolean;
}) {
  const data = useMemo(
    () =>
      rows
        .map((row) => ({
          date: new Date(row.ts),
          price: numericToNumber(row.share_price ?? null),
        }))
        .filter(
          (point): point is { date: Date; price: number } =>
            point.price !== null &&
            point.price > 0 &&
            !Number.isNaN(point.date.getTime()),
        ),
    [rows],
  );

  const formatUsd = useMemo(() => {
    const max = data.reduce((m, p) => Math.max(m, p.price), 0);
    return makeUsdFormatter(max);
  }, [data]);

  if (data.length < 2) {
    return (
      <div
        className="flex h-[320px] w-full items-center justify-center px-6"
        data-slot="basket-nav-chart"
      >
        <p className="text-center font-mono text-xs text-muted-foreground">
          {data.length === 0
            ? "No share-price snapshots indexed yet"
            : "One snapshot indexed — a line appears at two"}
        </p>
      </div>
    );
  }

  const tooltipRows = (point: Record<string, unknown>): TooltipRow[] => [
    {
      color: "hsl(var(--chart-1))",
      label: "Share price",
      value:
        typeof point.price === "number" && Number.isFinite(point.price)
          ? formatUsd(point.price)
          : "—",
    },
  ];

  return (
    <div className="h-[320px] w-full" data-slot="basket-nav-chart">
      <AreaChart
        data={data}
        xDataKey="date"
        fitYDomain={fitYDomain}
        margin={{ top: 12, right: 16, bottom: 28, left: 64 }}
        className="h-full w-full"
      >
        <Grid horizontal />
        <Area
          dataKey="price"
          fill="hsl(var(--chart-1))"
          stroke="hsl(var(--chart-1))"
          fillOpacity={NAV_FILL_OPACITY}
          strokeWidth={2}
        />
        {/* Fresh baskets have very few snapshots — cap ticks so the x-axis
            labels never crowd (data-aligned ticks dedupe duplicates). */}
        <XAxis numTicks={Math.min(5, Math.max(2, data.length))} />
        <YAxis numTicks={5} formatValue={formatUsd} />
        <ChartTooltip rows={tooltipRows} />
      </AreaChart>
    </div>
  );
}
