"use client";

import { useMemo } from "react";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import type { EquityPoint } from "@/lib/social-api";

/** Ethereal fill ceiling (charts only, same treatment as the NAV chart). */
const FILL_OPACITY = 0.06;

/**
 * Portfolio equity curve (valueUsd) over GET /users/:wallet/equity-curve
 * points — same composition as the basket NAV chart, no interpolation and no
 * fabricated points. Fewer than two snapshots renders as a quiet centered note.
 */
export function EquityCurveChart({ points }: { points: EquityPoint[] }) {
  const data = useMemo(
    () =>
      points
        .map((point) => ({
          date: new Date(point.ts),
          valueUsd: typeof point.valueUsd === "number" ? point.valueUsd : Number(point.valueUsd),
        }))
        .filter(
          (point): point is { date: Date; valueUsd: number } =>
            Number.isFinite(point.valueUsd) && !Number.isNaN(point.date.getTime()),
        ),
    [points],
  );

  if (data.length < 2) {
    return (
      <div className="flex h-[280px] w-full items-center justify-center px-6">
        <p className="text-center font-mono text-xs text-muted-foreground">
          {data.length === 0
            ? "No snapshot history yet"
            : "One snapshot indexed — a line appears at two"}
        </p>
      </div>
    );
  }

  return (
    <div className="h-[280px] w-full">
      <AreaChart
        data={data}
        xDataKey="date"
        fitYDomain
        margin={{ top: 12, right: 16, bottom: 28, left: 64 }}
        className="h-full w-full"
      >
        <Grid horizontal />
        <Area
          dataKey="valueUsd"
          fill="hsl(var(--chart-1))"
          stroke="hsl(var(--chart-1))"
          fillOpacity={FILL_OPACITY}
          strokeWidth={2}
        />
        <XAxis numTicks={Math.min(5, Math.max(2, data.length))} />
        <YAxis numTicks={5} />
        <ChartTooltip />
      </AreaChart>
    </div>
  );
}
