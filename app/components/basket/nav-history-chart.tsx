"use client";

import { useMemo } from "react";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { numericToNumber, type NavHistoryRow } from "@/components/basket/basket-api";

/** Ethereal fill ceiling for the chart-1 area (charts only, per style contract). */
const NAV_FILL_OPACITY = 0.06;

/**
 * Dominant historical NAV AreaChart (official Bklit AreaChart composition —
 * see components/charts/*). Raw snapshot series from
 * /baskets/:pubkey/nav/history; no interpolation, no fabricated points.
 * Fewer than two points renders as a quiet centered note so the hero card
 * keeps a stable height instead of collapsing.
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
          nav: numericToNumber(row.nav),
        }))
        .filter(
          (point): point is { date: Date; nav: number } =>
            point.nav !== null && !Number.isNaN(point.date.getTime()),
        ),
    [rows],
  );

  if (data.length < 2) {
    return (
      <div
        className="flex h-[320px] w-full items-center justify-center px-6"
        data-slot="basket-nav-chart"
      >
        <p className="text-center font-mono text-xs text-muted-foreground">
          {data.length === 0
            ? "No NAV snapshots indexed yet"
            : "One NAV snapshot indexed — a line appears at two"}
        </p>
      </div>
    );
  }

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
          dataKey="nav"
          fill="hsl(var(--chart-1))"
          stroke="hsl(var(--chart-1))"
          fillOpacity={NAV_FILL_OPACITY}
          strokeWidth={2}
        />
        {/* Fresh baskets have very few snapshots — cap ticks so the x-axis
            labels never crowd (data-aligned ticks dedupe duplicates). */}
        <XAxis numTicks={Math.min(5, Math.max(2, data.length))} />
        <YAxis numTicks={5} />
        <ChartTooltip />
      </AreaChart>
    </div>
  );
}
