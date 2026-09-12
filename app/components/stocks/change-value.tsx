import { cn } from "@/lib/utils";

/**
 * 24h change value with direction coloring.
 *
 * Color decision (NEON FOUNDRY, 2026-09-12): direction is SEMANTIC —
 * status-positive (neon green) for up, destructive (red) for down. Under the
 * cyberpunk palette chart-1/chart-2 became yellow/cyan data hues, so they can
 * no longer encode direction. Keep the classes here (single source of truth);
 * never scatter inline direction styles.
 */
export const CHANGE_UP_CLASS = "text-[hsl(var(--status-positive))]";
export const CHANGE_DOWN_CLASS = "text-[hsl(var(--destructive))]";

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
