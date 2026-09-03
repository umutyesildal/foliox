"use client";

import { useMemo } from "react";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { EmptyState } from "@/components/states";
import { numericToNumber, type NavHistoryRow } from "@/components/basket/basket-api";

/**
 * Dominant historical NAV AreaChart (official Bklit AreaChart composition —
 * see components/charts/*). Raw snapshot series from
 * /baskets/:pubkey/nav/history; no interpolation, no fabricated points.
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
      <EmptyState
        chip="NO CHART"
        title="Not enough NAV snapshots yet"
        description="The indexer stores a NAV snapshot per interval. Fewer than two points are indexed for this basket, so no line is drawn — nothing is interpolated."
      />
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
          fillOpacity={0.14}
          strokeWidth={2}
        />
        <XAxis />
        <YAxis numTicks={5} />
        <ChartTooltip />
      </AreaChart>
    </div>
  );
}
