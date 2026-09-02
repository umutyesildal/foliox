/**
 * A1 — full-width terminal status strip on top of the hero. Mono xs, bordered
 * bottom, warm black (bg-background). Real program facts only — no marketing,
 * no fabricated numbers.
 */
export function TerminalStrip() {
  return (
    <div className="border-b border-[hsl(var(--border-strong))] bg-background">
      <p className="mx-auto max-w-6xl truncate px-4 py-2 font-mono text-xs tracking-wide text-muted-foreground sm:px-6">
        <span className="text-foreground">FOLIOX DESK v0</span>
        <span aria-hidden="true"> · </span>
        basket factory
        <span aria-hidden="true"> · </span>
        fees ≤300/100/300 bps
        <span aria-hidden="true"> · </span>
        oracle-free
        <span aria-hidden="true"> · </span>
        immutable
      </p>
    </div>
  );
}
