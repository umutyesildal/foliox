"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface BrushSelection {
  start: Date;
  end: Date;
}

export interface ChartBrushLayoutProps {
  data: Record<string, unknown>[];
  xDataKey?: string;
  enabled?: boolean;
  height: number;
  brushStrip: (layout: {
    xDomain?: [Date, Date];
    xDomainSlotCount?: number;
    brushSelection: BrushSelection | null;
    onBrushSelectionChange: (s: BrushSelection) => void;
    data: Record<string, unknown>[];
  }) => React.ReactNode;
  children: (layout: {
    xDomain?: [Date, Date];
    xDomainSlotCount?: number;
    brushSelection: BrushSelection | null;
    onBrushSelectionChange: (s: BrushSelection) => void;
  }) => React.ReactNode;
  className?: string;
}

function getDate(d: Record<string, unknown>, xDataKey: string): Date | null {
  const v = d[xDataKey];
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string") {
    const dt = new Date(v as string | number);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function ChartBrushLayout({
  data,
  xDataKey = "date",
  enabled = true,
  height,
  brushStrip,
  children,
  className,
}: ChartBrushLayoutProps) {
  const len = data.length;

  // selection as indices [a,b]
  const [sel, setSel] = useState<[number, number]>(() => [0, Math.max(0, len - 1)]);

  // keep in sync when data length changes
  useEffect(() => {
    setSel((prev) => {
      const [a, b] = prev;
      if (len === 0) return [0, 0];
      const max = len - 1;
      // if previous was full range, keep full
      if (a === 0 && b === max) return prev;
      // clamp
      return [clamp(a, 0, max), clamp(b, 0, max)];
    });
  }, [len]);

  // Initialize to full range when len changes from 0
  useEffect(() => {
    if (len > 1) {
      setSel((prev) => {
        if (prev[1] >= len || prev[0] < 0) return [0, len - 1];
        return prev;
      });
    }
  }, [len]);

  const safe: [number, number] = useMemo(() => {
    if (len === 0) return [0, 0];
    const [a, b] = sel;
    return [clamp(a, 0, len - 1), clamp(b, 0, len - 1)];
  }, [sel, len]);

  const xDomain: [Date, Date] | undefined = useMemo(() => {
    if (!enabled || len < 2) return undefined;
    const [a, b] = safe;
    const s = Math.min(a, b);
    const e = Math.max(a, b);
    // if full range, still return domain for tween support but could be undefined to hint full
    const d0 = getDate(data[s], xDataKey);
    const d1 = getDate(data[e], xDataKey);
    if (!d0 || !d1) return undefined;
    // if covering full range, return domain anyway (consumer may use tweenYDomainOnXDomainChange)
    return [d0, d1];
  }, [enabled, len, safe, data, xDataKey]);

  const xDomainSlotCount = enabled ? len : undefined;

  const brushSelection: BrushSelection | null = useMemo(() => {
    if (!xDomain) return null;
    return { start: xDomain[0], end: xDomain[1] };
  }, [xDomain]);

  const onBrushSelectionChange = useCallback(
    (s: BrushSelection) => {
      if (len === 0) return;
      // find closest indices for dates
      let bestA = 0;
      let bestB = len - 1;
      let minDA = Number.POSITIVE_INFINITY;
      let minDB = Number.POSITIVE_INFINITY;
      const targetA = s.start.getTime();
      const targetB = s.end.getTime();
      for (let i = 0; i < len; i++) {
        const d = getDate(data[i], xDataKey);
        if (!d) continue;
        const t = d.getTime();
        const da = Math.abs(t - targetA);
        const db = Math.abs(t - targetB);
        if (da < minDA) {
          minDA = da;
          bestA = i;
        }
        if (db < minDB) {
          minDB = db;
          bestB = i;
        }
      }
      setSel([bestA, bestB]);
    },
    [len, data, xDataKey]
  );

  // slider handlers for indices
  const setStart = useCallback((v: number) => {
    setSel((prev) => [v, prev[1]]);
  }, []);
  const setEnd = useCallback((v: number) => {
    setSel((prev) => [prev[0], v]);
  }, []);

  const layout = useMemo(
    () => ({
      xDomain,
      xDomainSlotCount,
      brushSelection,
      onBrushSelectionChange,
    }),
    [xDomain, xDomainSlotCount, brushSelection, onBrushSelectionChange]
  );

  const brushLayoutForStrip = useMemo(
    () => ({
      xDomain,
      xDomainSlotCount,
      brushSelection,
      onBrushSelectionChange,
      data,
    }),
    [xDomain, xDomainSlotCount, brushSelection, onBrushSelectionChange, data]
  );

  if (!enabled) {
    return <div className={cn("flex flex-col gap-2 h-full", className)}>{children(layout)}</div>;
  }

  // compute slider visual progress for track highlight
  const startIdx = Math.min(safe[0], safe[1]);
  const endIdx = Math.max(safe[0], safe[1]);
  const progressLeft = len > 1 ? (startIdx / (len - 1)) * 100 : 0;
  const progressRight = len > 1 ? (endIdx / (len - 1)) * 100 : 100;
  const visibleCount = Math.abs(safe[1] - safe[0]) + 1;

  // date labels for footer (en-US — the adapter is English-language)
  const startDate = len ? getDate(data[startIdx], xDataKey) : null;
  const endDate = len ? getDate(data[endIdx], xDataKey) : null;
  const startLabel = startDate ? startDate.toLocaleDateString("en-US") : "";
  const endLabel = endDate ? endDate.toLocaleDateString("en-US") : "";

  return (
    <div className={cn("flex flex-col gap-2 h-full", className)}>
      <div className="flex-1 min-h-[180px] overflow-visible">{children(layout)}</div>

      <div className="shrink-0">
        <div style={{ height }} className="overflow-visible">
          {brushStrip(brushLayoutForStrip as any)}
        </div>

        {/* polished dual range slider */}
        <div className="mt-1 px-1">
          <div className="relative h-4 flex items-center">
            {/* track background */}
            <div className="absolute left-0 right-0 h-1.5 rounded-full bg-muted" />
            {/* selected range highlight */}
            <div
              className="absolute h-1.5 rounded-full bg-primary/30 border border-primary/40"
              style={{ left: `${progressLeft}%`, right: `${100 - progressRight}%` }}
            />
            {/* thumb indicators */}
            <div
              className="absolute h-3 w-1.5 -ml-0.5 rounded-full bg-primary shadow-sm border border-primary-foreground"
              style={{ left: `${progressLeft}%` }}
            />
            <div
              className="absolute h-3 w-1.5 -ml-0.5 rounded-full bg-primary shadow-sm border border-primary-foreground"
              style={{ left: `${progressRight}%` }}
            />
            <input
              type="range"
              min={0}
              max={Math.max(0, len - 1)}
              value={safe[0]}
              onChange={(e) => setStart(parseInt(e.target.value))}
              className="absolute inset-0 w-full h-4 opacity-0 cursor-pointer"
              aria-label="Brush start"
            />
            <input
              type="range"
              min={0}
              max={Math.max(0, len - 1)}
              value={safe[1]}
              onChange={(e) => setEnd(parseInt(e.target.value))}
              className="absolute inset-0 w-full h-4 opacity-0 cursor-pointer"
              aria-label="Brush end"
            />
          </div>

          <div className="flex gap-2 mt-1">
            <div className="flex-1 flex items-center gap-1.5 rounded border bg-card px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden="true" />
              <input
                type="range"
                min={0}
                max={Math.max(0, len - 1)}
                value={safe[0]}
                onChange={(e) => setStart(parseInt(e.target.value))}
                className="w-full accent-primary h-1"
                aria-label="Brush start (visible slider)"
              />
            </div>
            <div className="flex-1 flex items-center gap-1.5 rounded border bg-card px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-hidden="true" />
              <input
                type="range"
                min={0}
                max={Math.max(0, len - 1)}
                value={safe[1]}
                onChange={(e) => setEnd(parseInt(e.target.value))}
                className="w-full accent-primary h-1"
                aria-label="Brush end (visible slider)"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground px-1">
        <span>{startLabel}</span>
        <span className="font-mono">
          {visibleCount}/{len} candles · drag to zoom · range {startIdx}-{endIdx}
        </span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

export function ChartBrush({
  initialSelection,
  onSelectionChange,
  selection,
}: {
  initialSelection?: BrushSelection;
  onSelectionChange?: (s: BrushSelection) => void;
  selection?: BrushSelection;
}) {
  // Placeholder for bklit ChartBrush — visual brush is handled by ChartBrushLayout slider.
  // Keeping component for API compatibility and child-passthrough detection.
  return null;
}
ChartBrush.displayName = "ChartBrush";

export default ChartBrushLayout;
