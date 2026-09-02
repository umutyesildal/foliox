"use client";

import { useMemo } from "react";
import { useChartStable } from "@/components/charts/chart-context";

/**
 * Slim gray volume strip rendered inside the stock page AreaChart context.
 * Scales bars to the max volume of the visible (brushed) window, so the shared
 * brush drives both the price chart and this strip.
 *
 * Deliberately takes `volumeKey` (not `dataKey`) so the chart shell does not
 * register it as a line/area series — volume must not affect the y-domain.
 */
export default function VolumeBars({
  volumeKey = "volume",
}: {
  volumeKey?: string;
}) {
  const { data, xScale, innerHeight, innerWidth, columnWidth } =
    useChartStable();

  const layout = useMemo(() => {
    let maxVolume = 0;
    for (const d of data) {
      const v = d[volumeKey];
      if (typeof v === "number" && v > maxVolume) {
        maxVolume = v;
      }
    }
    if (maxVolume <= 0 || innerWidth <= 0 || innerHeight <= 0) {
      return null;
    }
    return {
      maxVolume,
      width: Math.max(1, Math.min(columnWidth * 0.62, 18)),
    };
  }, [data, volumeKey, innerWidth, innerHeight, columnWidth]);

  if (!layout) {
    return null;
  }
  const { maxVolume, width } = layout;

  return (
    <g fill="hsl(var(--muted-foreground))" fillOpacity={0.35}>
      {data.map((d, i) => {
        const v = d[volumeKey];
        if (typeof v !== "number" || v <= 0) {
          return null;
        }
        const raw = d.date;
        const date = raw instanceof Date ? raw : new Date(raw as string | number);
        const px = xScale(date);
        if (px == null || Number.isNaN(px)) {
          return null;
        }
        const x = Math.max(0, Math.min(px - width / 2, innerWidth - width));
        const h = Math.max(1, (v / maxVolume) * innerHeight);
        return (
          <rect
            key={i}
            x={x}
            y={innerHeight - h}
            width={width}
            height={h}
            rx={1}
            ry={1}
          />
        );
      })}
    </g>
  );
}
