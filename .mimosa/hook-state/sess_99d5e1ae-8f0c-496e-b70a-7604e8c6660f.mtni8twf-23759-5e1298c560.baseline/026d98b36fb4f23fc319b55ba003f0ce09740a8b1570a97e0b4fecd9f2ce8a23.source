import { cn } from "@/lib/utils";

/**
 * 24h change value with direction coloring.
 *
 * Color decision (per user decision, 2026-09-02): direction values on data
 * cards use the chart data tokens — chart-1 (green) for up, chart-2 (red) for
 * down. All other UI chrome stays monochrome. Keep the classes here (single
 * source of truth); never scatter inline direction styles.
 */
export const CHANGE_UP_CLASS = "text-[hsl(var(--chart-1))]";
export const CHANGE_DOWN_CLASS = "text-[hsl(var(--chart-2))]";

export function changeColorClass(changePct: number | null): string {
  if (changePct === null) return "text-muted-foreground";
  return changePct >= 0 ? CHANGE_UP_CLASS : CHANGE_DOWN_CLASS;
}

export function ChangeValue({
  changePct,
  className,
}: {
  /** Percent change; null renders an em dash in muted gray. */
  changePct: number | null;
  className?: string;
}) {
  return (
    <span className={cn("font-mono text-xs tabular-nums", changeColorClass(changePct), className)}>
      {changePct !== null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "—"}
    </span>
  );
}
