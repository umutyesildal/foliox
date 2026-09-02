import { Badge } from "@/components/ui/badge";

/**
 * A3 — simulated session card: a scripted terminal session showing the real
 * FolioX flow (create → mint → redeem) as command echo. Clearly badged
 * SIMULATED in the header; static text, no animation, no fabricated live data
 * — the weights and fee caps quoted are the program's actual rules.
 */
const SESSION_LINES: { kind: "cmd" | "ok"; text: string }[] = [
  {
    kind: "cmd",
    text: "$ foliox create-basket --weights TSLAx=3500,AAPLx=2500,NVDAx=2000,SPYx=2000",
  },
  { kind: "ok", text: "weights sum 10,000 bps" },
  { kind: "ok", text: "fees 300/100/300 · 90/10 split" },
  { kind: "ok", text: "seed + create = 1 atomic tx" },
  { kind: "cmd", text: "$ foliox mint --in-kind" },
  { kind: "cmd", text: "$ foliox redeem 100 shares  → pro-rata, floored, no pause" },
];

export function SessionCard({ className }: { className?: string }) {
  return (
    <div
      className={
        "overflow-hidden rounded-xl border border-[hsl(var(--border-strong))] bg-background font-mono " +
        (className ?? "")
      }
      role="img"
      aria-label="Simulated terminal session of the FolioX flow: create basket, mint in-kind, redeem"
    >
      {/* Header row — simulated badge is mandatory, never render without it */}
      <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--border-strong))] px-4 py-2.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          SESSION (simulated)
        </p>
        <Badge
          variant="outline"
          className="border-border px-1.5 py-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
        >
          simulated
        </Badge>
      </div>

      <div className="flex flex-col gap-2.5 px-4 py-4 text-xs leading-relaxed">
        {SESSION_LINES.map((line, i) =>
          line.kind === "cmd" ? (
            <p
              key={i}
              className="whitespace-pre-wrap break-words text-foreground/90"
            >
              {line.text}
            </p>
          ) : (
            <p key={i} className="flex items-start gap-2 text-muted-foreground">
              <span
                aria-hidden="true"
                className="shrink-0 text-[hsl(var(--status-positive))]"
              >
                ✓
              </span>
              <span>
                <span className="sr-only">ok — </span>
                {line.text}
              </span>
            </p>
          ),
        )}
      </div>
    </div>
  );
}
